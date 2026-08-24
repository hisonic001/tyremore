/**
 * 마진 리포트 — 과거 판매 줄에 원가 백필 (사장님 지시 2026-08-25)
 *
 *   원가 우선순위: ①그 상품의 최근 매입 단가(purchase_invoice_item.unit_cost)
 *                 ②상품의 매입가(product.purchase_price). 못 찾으면 그대로 빈 칸 —
 *   거짓 원가보다 빈 칸이 낫다. 대상은 실사용 판매(Q26-…)만 (MARS 이관분은 원가 근거 없음).
 *   margin = (판매가 − 원가) × 수량.
 *
 *   npx tsx scripts/backfill-purchase-cost.ts   (멱등 — 이미 원가 있는 줄은 안 건드림)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const a = await sql`
      UPDATE quote_item qi
      SET purchase_cost = c.cost, margin = (qi.final_price - c.cost) * qi.qty
      FROM (
        SELECT DISTINCT ON (pii.product_id) pii.product_id, pii.unit_cost AS cost
        FROM purchase_invoice_item pii
        JOIN purchase_invoice pi ON pi.id = pii.invoice_id
        WHERE pi.status <> '취소' AND pii.unit_cost IS NOT NULL AND pii.product_id IS NOT NULL
        ORDER BY pii.product_id, pii.id DESC
      ) c
      WHERE qi.product_id = c.product_id AND qi.purchase_cost IS NULL
        AND EXISTS (SELECT 1 FROM quote q WHERE q.id = qi.quote_id AND q.status = '성사' AND q.quote_no LIKE 'Q%')
      RETURNING qi.id`;
    const b = await sql`
      UPDATE quote_item qi
      SET purchase_cost = p.purchase_price, margin = (qi.final_price - p.purchase_price) * qi.qty
      FROM product p
      WHERE p.id = qi.product_id AND p.purchase_price IS NOT NULL AND qi.purchase_cost IS NULL
        AND EXISTS (SELECT 1 FROM quote q WHERE q.id = qi.quote_id AND q.status = '성사' AND q.quote_no LIKE 'Q%')
      RETURNING qi.id`;
    console.log(`✅ 원가 백필 — 최근 매입가 ${a.length}줄 + 상품 매입가 ${b.length}줄`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
