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
import { getSession, isOwner } from "./auth";

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

/** 입고된 본에 해당하는 재고 id 를 찾는다 — 못 찾거나 이미 팔렸으면 이유를 돌려준다 */
async function resolveStock(line: Line): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  if (line.receivedQty === 0) return { ok: true, ids: [] };

  // ① 정확한 연결 (2026-08-09 이후 입고분)
  const linked = await db
    .select({ id: stockItem.id, status: stockItem.status })
    .from(stockItem)
    .where(eq(stockItem.purchaseItemId, line.id));

  if (linked.length > 0) {
    const notInStock = linked.filter((s) => s.status !== "재고");
    if (notInStock.length > 0) {
      return {
        ok: false,
        error: `이미 판매·보관된 본이 ${notInStock.length}본 있어 지울 수 없습니다 — 해당 판매를 먼저 취소해 주세요`,
      };
    }
    return { ok: true, ids: linked.map((s) => s.id) };
  }

  // ② 예전 입고분 — 같은 상품·같은 매입가의 '재고' 본을 최신 것부터
  if (!line.productId) return { ok: false, error: "상품 연결이 없는 줄이라 재고를 되짚을 수 없습니다" };
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
  return { ok: true, ids: rows.map((r) => Number(r.id)) };
}

/** 재고 본과 이동 기록을 지운다 — 잘못 입고한 것은 「없던 일」이 맞다 */
async function deleteStock(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(stockMovement).where(inArray(stockMovement.stockItemId, ids));
  await db.delete(stockItem).where(inArray(stockItem.id, ids));
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
  if (!(await isOwner())) return { ok: false, error: "매입가는 사장님 계정에서만 고칠 수 있습니다" };
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
): Promise<{ ok: true; removedStock: number } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };

  const [line] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, itemId))
    .limit(1);
  if (!line) return { ok: false, error: "매입 줄을 찾을 수 없습니다" };

  const target = await resolveStock(line);
  if (!target.ok) return target;

  await deleteStock(target.ids);
  await db.delete(purchaseInvoiceItem).where(eq(purchaseInvoiceItem.id, line.id));
  await settleInvoice(line.invoiceId);

  refresh();
  return { ok: true, removedStock: target.ids.length };
}

/** 매입 한 건(장부째) 지우기 — 모든 줄의 재고를 되돌릴 수 있을 때만 */
export async function deletePurchaseInvoice(
  invoiceId: number,
): Promise<{ ok: true; removedStock: number } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };

  const lines = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.invoiceId, invoiceId));
  if (lines.length === 0) return { ok: false, error: "매입을 찾을 수 없습니다" };

  // 🔴 먼저 전부 되짚어지는지 확인 — 한 줄이라도 안 되면 아무것도 안 지운다
  const targets: number[] = [];
  for (const line of lines) {
    const t = await resolveStock(line);
    if (!t.ok) {
      const name = line.description || line.cai;
      return { ok: false, error: `「${name}」 줄: ${t.error}` };
    }
    targets.push(...t.ids);
  }

  await deleteStock(targets);
  await db.delete(purchaseInvoiceItem).where(eq(purchaseInvoiceItem.invoiceId, invoiceId));
  await db.execute(sql`DELETE FROM purchase_invoice WHERE id = ${invoiceId}`);

  refresh();
  return { ok: true, removedStock: targets.length };
}
