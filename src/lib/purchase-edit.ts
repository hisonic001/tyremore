"use server";

/**
 * ⭐ 매입 내역 수정·지우기 (사장님 요청 2026-08-09)
 *
 *   "매입내역에서 수정이나 지우기도 가능하게 만들어줘."
 *
 * 지우기의 핵심은 **입고가 만든 재고까지 되돌리는 것**이다. 매입 줄만 지우고
 * 재고를 남기면 장부와 실물이 어긋난다 (판매 취소가 재고를 복원하는 것과 같은 원리).
 *
 * 재고를 찾는 두 갈래:
 *   ① 오늘(2026-08-09)부터 입고되는 본은 stock_item.purchase_item_id 로 정확히 이어진다.
 *   ② 예전 재고는 연결이 없다 — 같은 상품 + 같은 매입가의 '재고' 본을 최신 것부터
 *      맞춰 지운다. 물리적으로 동일한 타이어라 어느 본을 지우든 재고 수는 같다.
 *      수가 안 맞으면(이미 팔렸거나 보관중) 지우지 않고 알린다.
 *
 * 🔴 이미 판매·보관된 본이 있으면 통째로 거부한다 — 반쯤 지워진 매입은
 *    더 큰 혼란이다. 판매를 먼저 취소하고 다시 지우면 된다.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { purchaseInvoiceItem, stockItem, stockMovement } from "@/db/schema";
import { getSession, hasPerm } from "./auth";

function refresh() {
  for (const p of ["/receiving/history", "/receiving", "/", "/stock"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

type Line = typeof purchaseInvoiceItem.$inferSelect;

/**
 * 되짚기 계획 — 무엇을 지우고(타이어 본) 무엇을 얼마나 뺄지(부품 수량).
 * 🔴 2026-08-18 사장님 신고로 재작성: 부품은 한 행에 수량인데 옛 코드가
 *    타이어처럼 **행 수**를 세서 「4본 중 1본밖에 못 찾았습니다」라며 거부했다
 *    (행 하나에 7개가 들어 있어도 1로 셌다). 지웠으면 행째 날려 7개가 사라질 뻔.
 */
interface StockPlan {
  /** 통째로 지울 타이어 본(1본 1행) */
  serialIds: number[];
  /** 수량을 뺄 부품 행들 */
  qtyTakes: { id: number; take: number }[];
  /** 재고가 모자라 못 뺀 수량 — 이미 팔린 것으로 본다 */
  short: number;
  /** '본'(타이어) 또는 '개'(부품) */
  unit: string;
}

async function resolveStock(line: Line): Promise<{ ok: true; plan: StockPlan } | { ok: false; error: string }> {
  const empty: StockPlan = { serialIds: [], qtyTakes: [], short: 0, unit: "개" };
  if (line.receivedQty === 0) return { ok: true, plan: empty };
  if (!line.productId) return { ok: false, error: "상품 연결이 없는 줄이라 재고를 되짚을 수 없습니다" };

  const [prod] = await db.execute<{ is_serialized: boolean }>(sql`
    SELECT is_serialized FROM product WHERE id = ${line.productId}
  `);
  const serialized = prod?.is_serialized !== false;

  if (serialized) {
    /* ── 타이어: 1본 1행 — 전부 정확히 되짚어질 때만 지운다 (물러섬 없음) ── */
    const linked = await db
      .select({ id: stockItem.id, status: stockItem.status })
      .from(stockItem)
      .where(eq(stockItem.purchaseItemId, line.id));
    if (linked.length > 0) {
      const notInStock = linked.filter((x) => x.status !== "재고");
      if (notInStock.length > 0) {
        return {
          ok: false,
          error: `이미 판매·보관된 본이 ${notInStock.length}본 있어 지울 수 없습니다 — 해당 판매를 먼저 취소해 주세요`,
        };
      }
      return { ok: true, plan: { ...empty, unit: "본", serialIds: linked.map((x) => x.id) } };
    }
    // 예전 입고분 — 같은 상품·같은 매입가의 '재고' 본을 최신 것부터
    const rows = await db.execute<{ id: number }>(sql`
      SELECT id FROM stock_item
      WHERE product_id = ${line.productId}
        AND status = '재고'
        AND purchase_price IS NOT DISTINCT FROM ${line.unitCost}
      ORDER BY id DESC
      LIMIT ${line.receivedQty}
    `);
    if (rows.length < line.receivedQty) {
      return {
        ok: false,
        error:
          `입고된 ${line.receivedQty}본 중 재고에서 ${rows.length}본밖에 찾지 못했습니다 ` +
          `(이미 팔렸거나 예전 자료라 연결이 없습니다). 재고 화면에서 수량을 직접 맞춰 주세요`,
      };
    }
    return { ok: true, plan: { ...empty, unit: "본", serialIds: rows.map((r) => Number(r.id)) } };
  }

  /* ── 부품: 한 행에 수량 — 그 상품의 재고 행들에서 수량을 뺀다 ──
   * 이 매입 줄에 연결된 행 → DOT 없는 행(부품 실사 자리) → 나머지 순으로.
   * 재고가 모자라면(이미 팔림) 있는 만큼만 빼고 지운다 — 재고의 진실은
   * 실사가 지키고, 잘못 들어간 매입 기록은 지워져야 하기 때문이다. */
  const rows = await db.execute<{ id: number; qty: number }>(sql`
    SELECT id, qty FROM stock_item
    WHERE product_id = ${line.productId} AND status = '재고' AND qty > 0
    ORDER BY (purchase_item_id = ${line.id}) DESC NULLS LAST, (dot IS NULL) DESC, id DESC
  `);
  let remain = line.receivedQty;
  const qtyTakes: { id: number; take: number }[] = [];
  for (const r of rows) {
    if (remain <= 0) break;
    const take = Math.min(remain, Number(r.qty));
    qtyTakes.push({ id: Number(r.id), take });
    remain -= take;
  }
  return { ok: true, plan: { serialIds: [], qtyTakes, short: remain, unit: "개" } };
}

/** 계획대로 재고를 되돌린다 — 타이어 본은 지우고, 부품은 수량을 빼며 이동 기록을 남긴다 */
async function applyStockPlan(plan: StockPlan, why: string): Promise<void> {
  if (plan.serialIds.length > 0) {
    await db.delete(stockMovement).where(inArray(stockMovement.stockItemId, plan.serialIds));
    await db.delete(stockItem).where(inArray(stockItem.id, plan.serialIds));
  }
  for (const t of plan.qtyTakes) {
    await db.execute(sql`UPDATE stock_item SET qty = qty - ${t.take} WHERE id = ${t.id} AND qty >= ${t.take}`);
    await db.insert(stockMovement).values({
      stockItemId: t.id,
      type: "조정",
      reason: why,
      qtyDelta: -t.take,
      memo: null,
      createdBy: null,
    });
  }
}

/** 사람이 읽을 결과 문장 — 몇 본을 지웠고 몇 개를 뺐고 몇 개가 모자랐는지 */
function planNote(plans: StockPlan[]): string {
  const tires = plans.reduce((n, p) => n + p.serialIds.length, 0);
  const parts = plans.reduce((n, p) => n + p.qtyTakes.reduce((x, t) => x + t.take, 0), 0);
  const short = plans.reduce((n, p) => n + p.short, 0);
  const bits: string[] = [];
  if (tires) bits.push(`타이어 ${tires}본`);
  if (parts) bits.push(`부품 ${parts}개`);
  let note = bits.length ? `재고에서 ${bits.join(" · ")}이(가) 같이 빠졌습니다.` : "재고 변동은 없습니다.";
  if (short) note += ` ⚠️ ${short}개는 재고에 없어 못 뺐습니다(이미 팔린 것으로 보입니다) — 실물과 다르면 재고 화면에서 맞춰 주세요.`;
  return note;
}

/** 장부 상태를 줄들의 입고 상황에 맞춘다. 줄이 하나도 없으면 장부째 지운다 */
async function settleInvoice(invoiceId: number): Promise<void> {
  const [left] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM purchase_invoice_item WHERE invoice_id = ${invoiceId}`,
  );
  if (Number(left.n) === 0) {
    await db.execute(sql`DELETE FROM purchase_invoice WHERE id = ${invoiceId}`);
    return;
  }
  await db.execute(sql`
    UPDATE purchase_invoice SET
      status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM purchase_invoice_item x
                         WHERE x.invoice_id = ${invoiceId} AND x.received_qty < x.qty)
        THEN '입고완료'
        WHEN EXISTS (SELECT 1 FROM purchase_invoice_item x
                     WHERE x.invoice_id = ${invoiceId} AND x.received_qty > 0)
        THEN '부분입고'
        ELSE '입고대기' END,
      updated_at = now()
    WHERE id = ${invoiceId}
  `);
}

/**
 * 본당 매입가 고치기 — 사장님만 (D-05).
 * 이 줄에서 입고된 재고의 매입가도 같이 맞춘다 (연결이 있는 본만) —
 * 원가·마진 계산이 재고 쪽 값을 쓰기 때문이다.
 */
export async function updatePurchaseCost(input: {
  itemId: number;
  unitCost: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("cost"))) return { ok: false, error: "매입가·마진 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  if (input.unitCost !== null && (!Number.isInteger(input.unitCost) || input.unitCost < 0)) {
    return { ok: false, error: "매입가를 확인해 주세요" };
  }

  const [line] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, input.itemId))
    .limit(1);
  if (!line) return { ok: false, error: "매입 줄을 찾을 수 없습니다" };

  await db
    .update(purchaseInvoiceItem)
    .set({
      unitCost: input.unitCost,
      supplyAmount: input.unitCost === null ? null : input.unitCost * line.qty,
    })
    .where(eq(purchaseInvoiceItem.id, line.id));
  await db
    .update(stockItem)
    .set({ purchasePrice: input.unitCost })
    .where(eq(stockItem.purchaseItemId, line.id));

  refresh();
  return { ok: true };
}

/** 매입 줄 하나 지우기 — 입고된 본을 재고에서 되돌리고 줄을 없앤다 */
export async function deletePurchaseLine(
  itemId: number,
): Promise<{ ok: true; removedStock: number; note: string } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };

  const [line] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, itemId))
    .limit(1);
  if (!line) return { ok: false, error: "매입 줄을 찾을 수 없습니다" };

  const target = await resolveStock(line);
  if (!target.ok) return target;

  await applyStockPlan(target.plan, "매입 지움(입고 취소)");
  await db.delete(purchaseInvoiceItem).where(eq(purchaseInvoiceItem.id, line.id));
  await settleInvoice(line.invoiceId);

  refresh();
  return {
    ok: true,
    removedStock: target.plan.serialIds.length + target.plan.qtyTakes.reduce((n, t) => n + t.take, 0),
    note: planNote([target.plan]),
  };
}

/** 매입 한 건(장부째) 지우기 — 모든 줄의 재고를 되돌릴 수 있을 때만 */
export async function deletePurchaseInvoice(
  invoiceId: number,
): Promise<{ ok: true; removedStock: number; note: string } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };

  const lines = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.invoiceId, invoiceId));
  if (lines.length === 0) return { ok: false, error: "매입을 찾을 수 없습니다" };

  // 🔴 먼저 전부 되짚어지는지 확인 — 한 줄이라도 안 되면 아무것도 안 지운다
  const plans: StockPlan[] = [];
  for (const line of lines) {
    const t = await resolveStock(line);
    if (!t.ok) {
      const name = line.description || line.cai;
      return { ok: false, error: `「${name}」 줄: ${t.error}` };
    }
    plans.push(t.plan);
  }

  for (const plan of plans) await applyStockPlan(plan, "매입 지움(입고 취소)");
  await db.delete(purchaseInvoiceItem).where(eq(purchaseInvoiceItem.invoiceId, invoiceId));
  await db.execute(sql`DELETE FROM purchase_invoice WHERE id = ${invoiceId}`);

  refresh();
  return {
    ok: true,
    removedStock: plans.reduce((n, p) => n + p.serialIds.length + p.qtyTakes.reduce((x, t) => x + t.take, 0), 0),
    note: planNote(plans),
  };
}
