import { sql, type SQL } from "drizzle-orm";

/**
 * ⭐ 원가 스냅샷 정본 (마진 리포트, 사장님 지시 2026-08-25 · 추출 2026-09-09)
 *
 *   파는 순간의 매입원가를 판매 줄에 박아 두는 판정 한 곳:
 *   ①그 상품의 최근 매입 단가(취소 전표 제외) ②없으면 상품의 매입가.
 *   못 찾으면 빈 칸 — 거짓 원가보다 빈 칸이 낫다. margin = (판매가 − 원가) × 수량.
 *
 *   판매 등록(sale.ts, tx 안)과 판매 후 줄 추가(sale-edit.ts, db)가 같이 쓴다 —
 *   그래서 실행기를 인자로 받는다. 여기 규칙을 바꾸면 두 경로가 같이 바뀐다.
 */
type SqlRunner = { execute(query: SQL): Promise<unknown> };

export async function costSnapshotMap(runner: SqlRunner, productIds: number[]): Promise<Map<number, number>> {
  const costIds = [...new Set(productIds.filter((v): v is number => !!v))].slice(0, 100);
  const costMap = new Map<number, number>();
  if (costIds.length === 0) return costMap;

  const inCost = sql.join(costIds.map((i) => sql`${i}`), sql`, `);
  const recent = (await runner.execute(sql`
    SELECT DISTINCT ON (pii.product_id) pii.product_id, pii.unit_cost
    FROM purchase_invoice_item pii
    JOIN purchase_invoice pi ON pi.id = pii.invoice_id
    WHERE pi.status <> '취소' AND pii.unit_cost IS NOT NULL AND pii.product_id IN (${inCost})
    ORDER BY pii.product_id, pii.id DESC
  `)) as { product_id: number; unit_cost: number }[];
  for (const r of recent) costMap.set(Number(r.product_id), Number(r.unit_cost));
  const base = (await runner.execute(sql`
    SELECT id, purchase_price FROM product WHERE purchase_price IS NOT NULL AND id IN (${inCost})
  `)) as { id: number; purchase_price: number }[];
  for (const r of base) if (!costMap.has(Number(r.id))) costMap.set(Number(r.id), Number(r.purchase_price));
  return costMap;
}
