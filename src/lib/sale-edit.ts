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
import { quote, quotePayment, stockItem, stockMovement } from "@/db/schema";
import { ALL_METHODS, checkSplitPayments } from "./payments";

function refresh() {
  for (const p of ["/sales", "/", "/stock"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

/** 작업일 · 결제수단 · 주행거리 · 메모를 고친다 — 금액과 품목은 여기서 못 고친다 */
export async function updateSaleHead(input: {
  quoteId: number;
  workDate?: string | null;
  paymentMethod?: string | null;
  /** ⭐ 분할 결제 (2026-08-10) — 2개 이상이면 paymentMethod 는 서버가 '혼합'으로 굳힌다 */
  payments?: { method: string; amount: number; paidOn?: string | null }[] | null;
  paymentMemo?: string | null;
  /**
   * ⭐ 주행거리 (사장님 지시 2026-08-17 — 주행거리 없는 판매는 MARS 체크가 막히므로
   *    여기서 채울 길이 있어야 한다). undefined = 안 건드림.
   */
  mileage?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status, total: quote.totalAmount, vehicleId: quote.vehicleId })
    .from(quote)
    .where(eq(quote.id, input.quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매는 고칠 수 없습니다" };

  const mileage = input.mileage === undefined ? undefined : Math.round(Number(input.mileage));
  if (mileage !== undefined && (!Number.isFinite(mileage) || mileage <= 0 || mileage > 2_000_000)) {
    return { ok: false, error: "주행거리가 올바르지 않습니다" };
  }

  const workDate = input.workDate?.trim() || null;
  if (workDate && !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return { ok: false, error: "날짜는 2026-08-04 형식입니다" };
  }
  // 분할이 넘어오면 합계와 맞는지 검증하고 '혼합'으로. 아니면 단일 수단 그대로 (2026-08-10)
  const splitCheck = checkSplitPayments(input.payments, q.total);
  if (!splitCheck.ok) return { ok: false, error: splitCheck.error };
  const split = splitCheck.split;
  const pay = split ? "혼합" : input.paymentMethod?.trim() || null;
  /* 🔴 목록을 여기 또 적지 않는다 — 정본은 lib/payments.ts 다.
     2026-08-29: 여기에만 하드코딩이 남아 있어 간편결제로 못 고쳤다
     (「결제수단이 올바르지 않습니다」 — 사장님 제보). 일마감의 「고치기」도 이 함수를 탄다. */
  const ALLOWED = ALL_METHODS;
  if (pay && !ALLOWED.includes(pay)) {
    return { ok: false, error: `결제수단이 올바르지 않습니다 — ${ALLOWED.join("·")} 중에서 고를 수 있습니다` };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quote)
      .set({
        ...(workDate ? { workDate } : {}),
        ...(mileage !== undefined ? { mileage } : {}),
        paymentMethod: pay,
        paymentMemo: input.paymentMemo?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(quote.id, input.quoteId));
    // 분할 내역은 통째로 갈아 끼운다 — 단일 수단으로 바꾸면 이전 분할 줄이 남으면 안 된다
    await tx.delete(quotePayment).where(eq(quotePayment.quoteId, input.quoteId));
    if (split) {
      await tx.insert(quotePayment).values(
        split.map((p) => ({
          quoteId: input.quoteId,
          method: p.method,
          amount: p.amount,
          // ⭐ 받은 날 (예약거래 2026-09-01) — 비면 작업일로 해석
          paidOn: /^\d{4}-\d{2}-\d{2}$/.test(p.paidOn ?? "") ? p.paidOn : null,
        })),
      );
    }
    /**
     * 차량의 최근 주행거리도 따라 올린다 — 단, **키우기만 한다.**
     * 여기는 과거 판매를 고치는 자리라, 옛 판매에 작은 값을 넣었다고 차량의
     * 최신 주행거리가 뒷걸음치면 안 된다 (saveSale 은 새 판매라 무조건 덮는다).
     */
    if (mileage !== undefined && q.vehicleId) {
      await tx.execute(sql`
        UPDATE vehicle SET mileage = ${mileage}, mileage_at = now()
        WHERE id = ${q.vehicleId} AND (mileage IS NULL OR mileage < ${mileage})
      `);
    }
  });

  refresh();
  return { ok: true };
}

/**
 * ⭐ 예약 시공 완료 (사장님 요청 2026-09-01) — 이제야 재고가 빠진다.
 *
 *   예약 저장은 재고를 안 건드렸다. 손님이 실제로 오셔서 시공한 날 이 버튼으로
 *   상품 줄만큼 재고를 뺀다. 재고가 모자라면 막지 않고 부족분을 알린다
 *   (급한 손님에게 예약분을 먼저 팔 수 있다는 사장님 방침 — 재주문 신호).
 *   매출 날(work_date)은 안 건드린다 — 돈은 받은 날 그대로다.
 *
 * 🔴 멱등 — 「예약중」일 때만 차감한다. 두 번 눌러도 재고가 두 번 빠지지 않는다.
 */
export async function fulfillReservation(
  quoteId: number,
): Promise<{ ok: true; shortages: string[] } | { ok: false; error: string }> {
  const [q] = await db.execute<{ id: number; status: string; reservation_status: string | null; quote_no: string }>(sql`
    SELECT id, status, reservation_status, quote_no FROM quote WHERE id = ${quoteId}
  `);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매입니다" };
  if (q.reservation_status === "시공완료") return { ok: false, error: "이미 시공 완료된 예약입니다" };
  if (q.reservation_status !== "예약중") return { ok: false, error: "예약 건이 아닙니다" };

  const lines = await db.execute<{ product_id: number | null; qty: number; description: string }>(sql`
    SELECT product_id, qty, description FROM quote_item WHERE quote_id = ${quoteId}
  `);
  const shortages: string[] = [];
  const { sellFromStock } = await import("./sale");
  for (const l of lines) {
    if (!l.product_id) continue;
    const { short } = await sellFromStock(Number(l.product_id), Number(l.qty), quoteId);
    if (short > 0) shortages.push(`${l.description} ${short}본`);
  }
  await db.execute(sql`
    UPDATE quote SET reservation_status = '시공완료',
      fulfilled_on = (now() AT TIME ZONE 'Asia/Seoul')::date, updated_at = now()
    WHERE id = ${quoteId}
  `);
  refresh();
  return { ok: true, shortages };
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

  /**
   * 🔴 수금이 이미 들어간 판매는 못 지운다 (월 정산 작업 중 발견한 구멍, 2026-09-01).
   *    외상 장부는 status='성사' 만 세므로 취소하는 순간 그 건이 장부에서 사라지는데,
   *    receivable_payment 줄은 그대로 남아 **받은 돈이 허공에 뜬다.**
   */
  const [rp] = await db.execute<{ n: number; s: number }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(amount), 0)::int s
    FROM receivable_payment WHERE quote_id = ${quoteId}
  `);
  if (Number(rp?.n ?? 0) > 0) {
    return {
      ok: false,
      error: `수금 ${Number(rp.s).toLocaleString()}원이 이미 들어간 판매입니다 — 외상 화면에서 수금 기록을 먼저 지운 뒤 취소해 주세요`,
    };
  }

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
   * 재고 복원 — 이 판매의 **순변동(출고 − 이미 되돌린 반품)** 만큼만 되감는다.
   *
   * 🔴 출고 이력만 보면 안 된다 (코드 리뷰 2026-08-08).
   *    줄 수정(updateSaleLine)이 이미 일부를 반품으로 되돌려 놓았는데 취소가
   *    출고 전량을 또 되감아, 4본 판 것에 6본이 살아나는 유령 재고가 생겼다.
   *    행마다 이 판매의 모든 이력을 합산하면 두 번 눌러도 이중 복원이 없다.
   */
  const moves = await db.execute<{ stock_item_id: number; net: number }>(sql`
    SELECT stock_item_id, -SUM(qty_delta)::int AS net
    FROM stock_movement
    WHERE quote_id = ${quoteId}
    GROUP BY stock_item_id
    HAVING SUM(qty_delta) < 0
  `);

  let restored = 0;
  for (const m of moves) {
    const take = Number(m.net);
    if (take <= 0) continue;
    const [item] = await db
      .select({ id: stockItem.id, status: stockItem.status, qty: stockItem.qty, quoteId: stockItem.quoteId })
      .from(stockItem)
      .where(eq(stockItem.id, Number(m.stock_item_id)))
      .limit(1);
    if (!item) continue;

    if (item.status === "판매완료" && item.quoteId === quoteId) {
      /**
       * 🔴 부품 행은 판매완료 때 qty 가 그대로 남아 있다 — 상태만 되돌리면
       *    원래 수량 전체가 살아난다. 복원 수량을 qty 로 **명시**한다
       *    (타이어 1본 1행은 take=1 이라 결과가 같다). (코드 리뷰 2026-08-08)
       */
      await db
        .update(stockItem)
        .set({ status: "재고", soldAt: null, quoteId: null, qty: take })
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
 * 🔴 MARS 에 보낸 판매는 품목을 **막는다** (사장님 결정 2026-08-31 — "전송 전에만").
 *    · 미전송: 지금 매장 PC 로봇이 그 건을 MARS 화면에 치고 있을 수 있다 — 그 사이
 *      줄을 더하면 로봇은 옛 줄만 넣고 옛 금액으로 대조를 통과해 **전기까지 해 버린다.**
 *    · 전송완료: 전기(Posting)는 되돌릴 수 없다(D-08). 고치려면 MARS 칸에서
 *      「수동처리」로 내린 뒤 고치고, MARS 쪽은 사장님이 직접 맞추신다.
 *    (전에는 경고만 하고 marsMemo 에 「수정됨」을 남겼다 — 실제로 쓰인 건 3번뿐이었다.)
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
  /* 🔴 MARS 에 보낸 판매는 품목을 못 고친다 (사장님 결정 2026-08-31).
     「미전송」 차단은 sale-reassign.ts 선례 그대로 — 확인을 물어도 안 되는 상태다.
     ⚠️ updateSaleHead(날짜·결제수단)는 이 함수를 안 탄다 — 카드 일마감의 「고치기」가
     전송완료 건에도 매일 쓰이기 때문에 거기는 막지 않는다. */
  if (q.marsStatus === "미전송") {
    return { error: "지금 MARS 에 올리는 중입니다 — 끝난 뒤에 고쳐 주세요" };
  }
  if (q.marsStatus === "전송완료") {
    return {
      error:
        "MARS 에 이미 들어간 판매라 품목을 고칠 수 없습니다 — 정말 고쳐야 하면 MARS 칸에서 「수동처리」로 내린 뒤 고치고, MARS 쪽도 직접 맞춰 주세요",
    };
  }
  return { q };
}

/**
 * 합계를 품목에서 다시 계산해 머리에 쓴다 — 손으로 맞추면 반드시 어긋난다.
 * ⭐ 분할 결제가 있는 판매는 합이 어긋났는지 알려준다 (2026-08-10) —
 *    품목을 고쳐 합계가 바뀌면 수단별 금액도 사람이 다시 맞춰야 한다.
 */
async function recomputeTotal(quoteId: number): Promise<string | null> {
  await db.execute(sql`
    UPDATE quote SET
      total_amount = COALESCE((SELECT SUM(qty * final_price) FROM quote_item WHERE quote_id = ${quoteId}), 0),
      paid_amount  = COALESCE((SELECT SUM(qty * final_price) FROM quote_item WHERE quote_id = ${quoteId}), 0),
      updated_at = now()
    WHERE id = ${quoteId}
  `);
  const [chk] = await db.execute<{ total: number; ssum: number | null }>(sql`
    SELECT q.total_amount total,
           (SELECT SUM(amount)::int FROM quote_payment WHERE quote_id = q.id) ssum
    FROM quote q WHERE q.id = ${quoteId}
  `);
  if (chk?.ssum != null && Number(chk.ssum) !== Number(chk.total)) {
    return "금액이 바뀌어 분할 결제 합계와 어긋납니다 — 「날짜·결제 고치기」에서 수단별 금액을 다시 맞춰 주세요";
  }
  return null;
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
      // 🔴 부품 행은 판매완료 때 qty 가 남아 있다 — 복원 수량을 명시해야 과복원이 없다 (2026-08-08)
      await db
        .update(stockItem)
        .set({ status: "재고", soldAt: null, quoteId: null, qty: take })
        .where(eq(stockItem.id, Number(r.id)));
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
}): Promise<{ ok: true; shortage: number; warning: string | null } | { ok: false; error: string }> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) return { ok: false, error: "수량은 1 이상이어야 합니다" };
  // 마이너스 단가 허용 — 환불·카드 취소 줄 (사장님 요청 2026-08-21)
  if (!Number.isFinite(input.unitPrice)) return { ok: false, error: "단가가 올바르지 않습니다" };
  const desc = input.description?.trim();
  if (input.description !== undefined && !desc) return { ok: false, error: "품목 이름은 비울 수 없습니다" };

  const [line] = await db.execute<{ id: number; quote_id: number; product_id: number | null; qty: number; final_price: number; line_type: string }>(
    sql`SELECT id, quote_id, product_id, qty, final_price, line_type FROM quote_item WHERE id = ${input.itemId}`,
  );
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  // ⭐ 부품(use) 줄도 금액을 고칠 수 있다 (사장님 요청 2026-08-24) — 0원이면 종전처럼
  //    재고만 차감, 금액이 있으면 청구·MARS 대상 (mars-queue 가 0원 use 만 거른다)
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
  const warning = await recomputeTotal(e.q.id);
  refresh();
  return { ok: true, shortage, warning };
}

/** 줄 지우기 — 재고는 되살아난다. 마지막 줄은 못 지운다 (그건 판매 취소다) */
export async function removeSaleLine(
  itemId: number,
): Promise<{ ok: true; restored: number; warning: string | null } | { ok: false; error: string }> {
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
  const warning = await recomputeTotal(e.q.id);
  refresh();
  return { ok: true, restored, warning };
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
}): Promise<{ ok: true; shortage: number; warning: string | null } | { ok: false; error: string }> {
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
  const warning = await recomputeTotal(e.q.id);
  refresh();
  return { ok: true, shortage, warning };
}
