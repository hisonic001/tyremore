"use server";

/**
 * 정비 내역 수정·취소 (사장님 요청 2026-08-04)
 *
 *   "정비내역이 시스템에 저장되고 관리되고 수정되고 삭제도 가능해야함."
 *
 * 지금까지는 판매를 등록하면 **되돌릴 길이 없었다.** 수량을 잘못 치면 재고가
 * 어긋난 채로 고칠 방법이 없었다. 스키마는 처음부터 약속하고 있었다 —
 *   "취소 → 성사였다면 재고를 되돌린다" (quote.status 주석)
 * 이제야 그 약속을 지킨다.
 *
 * 🔴 **지우지 않고 「취소」로 남긴다.** 지워 버리면 「그날 무슨 일이 있었나」가
 *    사라진다. 잘못 등록한 것도 기록이다 — 화면에서 취소 표시로 보여 준다.
 *
 * 🔴 재고 복원은 **입출고 이력(stock_movement)을 근거로** 한다.
 *    부품은 판매 때 행이 남고 수량만 줄기 때문에, 어느 행에서 몇 개를 뺐는지는
 *    이력에만 정확히 남아 있다. 짐작으로 되돌리면 실물과 어긋난다.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote, stockItem, stockMovement } from "@/db/schema";

function refresh() {
  for (const p of ["/sales", "/mars", "/", "/stock"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

/** 작업일 · 결제수단 · 메모를 고친다 — 금액과 품목은 여기서 못 고친다 */
export async function updateSaleHead(input: {
  quoteId: number;
  workDate?: string | null;
  paymentMethod?: string | null;
  paymentMemo?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status })
    .from(quote)
    .where(eq(quote.id, input.quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매는 고칠 수 없습니다" };

  const workDate = input.workDate?.trim() || null;
  if (workDate && !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return { ok: false, error: "날짜는 2026-08-04 형식입니다" };
  }
  const pay = input.paymentMethod?.trim() || null;
  if (pay && !["현금", "카드", "계좌이체", "외상", "혼합", "서비스"].includes(pay)) {
    return { ok: false, error: "결제수단이 올바르지 않습니다" };
  }

  await db
    .update(quote)
    .set({
      ...(workDate ? { workDate } : {}),
      paymentMethod: pay,
      paymentMemo: input.paymentMemo?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, input.quoteId));

  refresh();
  return { ok: true };
}

/**
 * ⭐ 판매 취소 — 재고가 되살아난다.
 *
 * @param confirmMars MARS 에 이미 들어간 판매(전송완료)를 취소할 때는
 *                    이 확인이 있어야 한다. 우리 쪽만 취소하면 MARS 와 어긋나는데,
 *                    그걸 알고 누르시는 건지 화면이 한 번 더 묻는다.
 */
export async function cancelSale(
  quoteId: number,
  confirmMars = false,
  userId?: number,
): Promise<
  | { ok: true; restored: number; marsWarning: string | null }
  | { ok: false; error: string; needMarsConfirm?: boolean }
> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status, marsStatus: quote.marsStatus, quoteNo: quote.quoteNo })
    .from(quote)
    .where(eq(quote.id, quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "이미 취소된 판매입니다" };

  if (q.marsStatus === "전송완료" && !confirmMars) {
    return {
      ok: false,
      needMarsConfirm: true,
      error:
        "이 판매는 MARS 에 이미 들어갔습니다. 여기서 취소해도 MARS 에는 남아 있으니 " +
        "MARS 에서도 직접 지우셔야 합니다. 그래도 취소할까요?",
    };
  }

  /**
   * 재고 복원 — 이 판매의 출고 이력을 하나씩 되감는다.
   *   타이어(1본 1행): 판매완료 행을 재고로 되돌린다
   *   부품(수량 행):   줄었던 수량을 다시 더한다
   */
  const moves = await db
    .select({ id: stockMovement.id, stockItemId: stockMovement.stockItemId, qtyDelta: stockMovement.qtyDelta })
    .from(stockMovement)
    .where(and(eq(stockMovement.quoteId, quoteId), eq(stockMovement.type, "출고")));

  let restored = 0;
  const now = new Date();
  for (const m of moves) {
    const take = -m.qtyDelta; // 출고는 음수로 남는다
    if (take <= 0) continue;
    const [item] = await db
      .select({ id: stockItem.id, status: stockItem.status, qty: stockItem.qty, quoteId: stockItem.quoteId })
      .from(stockItem)
      .where(eq(stockItem.id, m.stockItemId))
      .limit(1);
    if (!item) continue;

    if (item.status === "판매완료" && item.quoteId === quoteId) {
      await db
        .update(stockItem)
        .set({ status: "재고", soldAt: null, quoteId: null })
        .where(eq(stockItem.id, item.id));
    } else {
      // 부품 — 행은 그대로 있고 수량만 줄어 있었다
      await db.update(stockItem).set({ qty: item.qty + take }).where(eq(stockItem.id, item.id));
    }
    await db.insert(stockMovement).values({
      stockItemId: item.id,
      type: "반품",
      reason: "판매취소",
      qtyDelta: take,
      quoteId,
      memo: `${q.quoteNo} 취소`,
      createdBy: userId ?? null,
    });
    restored += take;
  }

  const marsWarning =
    q.marsStatus === "전송완료"
      ? "MARS 에는 아직 남아 있습니다 — MARS 매출 주문(또는 송장)을 직접 지워 주세요"
      : null;

  await db
    .update(quote)
    .set({
      status: "취소",
      ...(marsWarning
        ? { marsMemo: sql`COALESCE(${quote.marsMemo} || ' · ', '') || '취소됨 — MARS 에서도 삭제 필요'` }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  refresh();
  return { ok: true, restored, marsWarning };
}

/* ============================================================
 * ⭐ 품목 줄 수정 (사장님 요청 2026-08-05 — "수정도 더 자유롭게")
 *
 * 지금까지는 「틀렸으면 취소하고 다시 등록」뿐이었다. 이제 줄 하나를
 * 고치고·지우고·더할 수 있다. 재고는 그때그때 따라간다:
 *   수량이 늘면 → 재고에서 더 빼고 (오래된 DOT 부터)
 *   수량이 줄거나 줄을 지우면 → 이 판매의 출고 이력을 근거로 되돌린다
 *
 * 🔴 MARS 전송완료 건을 고치면 MARS 와 금액이 어긋난다 — 경고를 돌려주고
 *    marsMemo 에도 남긴다. 화면이 그걸 보여 주고 사장님이 판단하신다.
 * ========================================================== */

/** 취소 아님 + 존재 확인. 자주 쓰여서 한 곳에 모은다 */
async function editableQuote(
  quoteId: number,
): Promise<{ error: string; q?: never } | { error?: never; q: { id: number; status: string; marsStatus: string; quoteNo: string } }> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status, marsStatus: quote.marsStatus, quoteNo: quote.quoteNo })
    .from(quote)
    .where(eq(quote.id, quoteId))
    .limit(1);
  if (!q) return { error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { error: "취소된 판매는 고칠 수 없습니다" };
  return { q };
}

/** 합계를 품목에서 다시 계산해 머리에 쓴다 — 손으로 맞추면 반드시 어긋난다 */
async function recomputeTotal(quoteId: number) {
  await db.execute(sql`
    UPDATE quote SET
      total_amount = COALESCE((SELECT SUM(qty * final_price) FROM quote_item WHERE quote_id = ${quoteId}), 0),
      paid_amount  = COALESCE((SELECT SUM(qty * final_price) FROM quote_item WHERE quote_id = ${quoteId}), 0),
      updated_at = now()
    WHERE id = ${quoteId}
  `);
}

/** MARS 에 이미 들어간 건이면 경고를 만들고 메모에도 한 번만 남긴다 */
async function marsMismatchNote(quoteId: number, marsStatus: string): Promise<string | null> {
  if (marsStatus !== "전송완료") return null;
  await db.execute(sql`
    UPDATE quote SET mars_memo = COALESCE(mars_memo || ' · ', '') || '수정됨 — MARS 금액 확인 필요'
    WHERE id = ${quoteId} AND (mars_memo IS NULL OR mars_memo NOT LIKE '%수정됨 — MARS 금액 확인 필요%')
  `);
  return "MARS 에 이미 들어간 판매라 금액이 어긋날 수 있습니다 — MARS 쪽도 확인해 주세요";
}

/**
 * 이 판매·이 상품의 출고를 `want` 만큼 되돌린다 (부분 복원).
 * 🔴 근거는 입출고 이력이다 — 행마다 「이 판매로 나간 양 − 이미 되돌린 양」을
 *    계산해서, 남아 있는 만큼만 되돌린다. 두 번 고쳐도 이중 복원되지 않는다.
 */
async function restoreStockFor(
  quoteId: number,
  quoteNo: string,
  productId: number,
  want: number,
  userId?: number,
): Promise<number> {
  const rows = await db.execute<{ id: number; status: string; qty: number; quote_id: number | null; out: number }>(sql`
    SELECT s.id, s.status, s.qty, s.quote_id,
           -(SELECT COALESCE(SUM(m.qty_delta), 0) FROM stock_movement m
              WHERE m.stock_item_id = s.id AND m.quote_id = ${quoteId})::int AS out
    FROM stock_item s
    WHERE s.product_id = ${productId}
      AND EXISTS (SELECT 1 FROM stock_movement m WHERE m.stock_item_id = s.id AND m.quote_id = ${quoteId})
    ORDER BY s.id DESC
  `);
  let left = want;
  let restored = 0;
  for (const r of rows) {
    if (left <= 0) break;
    const out = Number(r.out);
    if (out <= 0) continue;
    const take = Math.min(out, left);
    if (r.status === "판매완료" && Number(r.quote_id) === quoteId) {
      await db.update(stockItem).set({ status: "재고", soldAt: null, quoteId: null }).where(eq(stockItem.id, Number(r.id)));
    } else {
      await db.update(stockItem).set({ qty: Number(r.qty) + take }).where(eq(stockItem.id, Number(r.id)));
    }
    await db.insert(stockMovement).values({
      stockItemId: Number(r.id),
      type: "반품",
      reason: "판매수정",
      qtyDelta: take,
      quoteId,
      memo: `${quoteNo} 수정`,
      createdBy: userId ?? null,
    });
    left -= take;
    restored += take;
  }
  return restored;
}

/**
 * 줄 하나 고치기 — 수량·단가·품명.
 * ⭐ 품명도 키보드로 고칠 수 있다 (사장님 요청 2026-08-06 — "내용도 키보드로 수정").
 *    품명만 바꾼 것은 금액이 안 변하므로 MARS 어긋남 경고를 남기지 않는다.
 */
export async function updateSaleLine(input: {
  itemId: number;
  qty: number;
  unitPrice: number;
  description?: string;
  /** ⭐ 줄별 메모 (2026-08-07) — null 이면 지운다, undefined 면 안 건드린다 */
  memo?: string | null;
}): Promise<{ ok: true; shortage: number; marsWarning: string | null } | { ok: false; error: string }> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) return { ok: false, error: "수량은 1 이상이어야 합니다" };
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) return { ok: false, error: "단가가 올바르지 않습니다" };
  const desc = input.description?.trim();
  if (input.description !== undefined && !desc) return { ok: false, error: "품목 이름은 비울 수 없습니다" };

  const [line] = await db.execute<{ id: number; quote_id: number; product_id: number | null; qty: number; final_price: number }>(
    sql`SELECT id, quote_id, product_id, qty, final_price FROM quote_item WHERE id = ${input.itemId}`,
  );
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  const e = await editableQuote(Number(line.quote_id));
  if (e.error !== undefined) return { ok: false, error: e.error };

  let shortage = 0;
  const delta = input.qty - Number(line.qty);
  if (line.product_id && delta > 0) {
    const { sellFromStock } = await import("./sale");
    const { short } = await sellFromStock(Number(line.product_id), delta, e.q.id);
    shortage = short;
  } else if (line.product_id && delta < 0) {
    await restoreStockFor(e.q.id, e.q.quoteNo, Number(line.product_id), -delta);
  }

  await db.execute(sql`
    UPDATE quote_item SET qty = ${input.qty}, final_price = ${input.unitPrice}
      ${desc !== undefined ? sql`, description = ${desc}` : sql``}
      ${input.memo !== undefined ? sql`, memo = ${input.memo?.trim() || null}` : sql``}
    WHERE id = ${input.itemId}
  `);
  await recomputeTotal(e.q.id);
  const amountChanged = delta !== 0 || input.unitPrice !== Number(line.final_price);
  const marsWarning = amountChanged ? await marsMismatchNote(e.q.id, e.q.marsStatus) : null;
  refresh();
  return { ok: true, shortage, marsWarning };
}

/** 줄 지우기 — 재고는 되살아난다. 마지막 줄은 못 지운다 (그건 판매 취소다) */
export async function removeSaleLine(
  itemId: number,
): Promise<{ ok: true; restored: number; marsWarning: string | null } | { ok: false; error: string }> {
  const [line] = await db.execute<{ id: number; quote_id: number; product_id: number | null; qty: number }>(
    sql`SELECT id, quote_id, product_id, qty FROM quote_item WHERE id = ${itemId}`,
  );
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  const e = await editableQuote(Number(line.quote_id));
  if (e.error !== undefined) return { ok: false, error: e.error };

  const [cnt] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM quote_item WHERE quote_id = ${line.quote_id}`,
  );
  if (Number(cnt?.n ?? 0) <= 1) {
    return { ok: false, error: "마지막 품목은 지울 수 없습니다 — 판매 자체를 취소해 주세요" };
  }

  let restored = 0;
  if (line.product_id) {
    restored = await restoreStockFor(e.q.id, e.q.quoteNo, Number(line.product_id), Number(line.qty));
  }
  await db.execute(sql`DELETE FROM quote_item WHERE id = ${itemId}`);
  await recomputeTotal(e.q.id);
  const marsWarning = await marsMismatchNote(e.q.id, e.q.marsStatus);
  refresh();
  return { ok: true, restored, marsWarning };
}

/** 줄 더하기 — 상품이면 재고에서 빠진다 */
export async function addSaleLine(input: {
  quoteId: number;
  kind: "tire" | "service" | "custom";
  productId?: number | null;
  serviceItemId?: number | null;
  description: string;
  qty: number;
  unitPrice: number;
}): Promise<{ ok: true; shortage: number; marsWarning: string | null } | { ok: false; error: string }> {
  if (!input.description.trim()) return { ok: false, error: "품목 이름이 없습니다" };
  if (!Number.isInteger(input.qty) || input.qty <= 0) return { ok: false, error: "수량은 1 이상이어야 합니다" };
  const e = await editableQuote(input.quoteId);
  if (e.error !== undefined) return { ok: false, error: e.error };

  await db.execute(sql`
    INSERT INTO quote_item (quote_id, line_type, product_id, service_item_id, description, qty, final_price)
    VALUES (${input.quoteId}, ${input.kind}, ${input.productId ?? null}, ${input.serviceItemId ?? null},
            ${input.description.trim()}, ${input.qty}, ${input.unitPrice})
  `);

  let shortage = 0;
  if (input.productId) {
    const { sellFromStock } = await import("./sale");
    const { short } = await sellFromStock(input.productId, input.qty, e.q.id);
    shortage = short;
  }
  await recomputeTotal(e.q.id);
  const marsWarning = await marsMismatchNote(e.q.id, e.q.marsStatus);
  refresh();
  return { ok: true, shortage, marsWarning };
}
