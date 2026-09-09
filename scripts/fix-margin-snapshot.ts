/**
 * ⭐ 마진 스냅샷 불일치 전수 재계산 (마진 검증 2026-09-09)
 *
 *   updateSaleLine 이 수량·단가를 고치고도 margin 을 안 고쳐 생긴 왜곡을 정정한다.
 *   공식이 정본: 원가 아는 줄은 margin = (final_price − purchase_cost) × qty.
 *   원가 모르는 줄(purchase_cost NULL)은 margin 도 NULL 이어야 한다.
 *   대상을 못 박지 않고 「불일치 전수」로 만들어 멱등 — 재발 시 그대로 재실행.
 *
 * 실행: npx tsx --env-file=.env.local scripts/fix-margin-snapshot.ts        (보기만)
 *       npx tsx --env-file=.env.local scripts/fix-margin-snapshot.ts --fix  (정정)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  const doFix = process.argv.includes("--fix");

  const bad = await db.execute<{
    id: number;
    quote_no: string;
    description: string;
    qty: number;
    final_price: number;
    purchase_cost: number | null;
    margin: number | null;
    want: number | null;
  }>(sql`
    SELECT qi.id, q.quote_no, qi.description, qi.qty, qi.final_price, qi.purchase_cost, qi.margin,
           CASE WHEN qi.purchase_cost IS NOT NULL
                THEN (qi.final_price - qi.purchase_cost) * qi.qty END AS want
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE qi.margin IS DISTINCT FROM
          (CASE WHEN qi.purchase_cost IS NOT NULL
                THEN (qi.final_price - qi.purchase_cost) * qi.qty END)
    ORDER BY qi.id`);

  if (bad.length === 0) {
    console.log("불일치 0건 — 고칠 것 없음");
    process.exit(0);
  }

  console.log(`── 불일치 ${bad.length}건 ──`);
  for (const r of bad) {
    console.log(
      `qi ${r.id} [${r.quote_no}] ${r.description} ×${r.qty} @${Number(r.final_price).toLocaleString()}` +
        ` 원가 ${r.purchase_cost === null ? "빈칸" : Number(r.purchase_cost).toLocaleString()}` +
        ` : margin ${r.margin === null ? "빈칸" : Number(r.margin).toLocaleString()}` +
        ` → ${r.want === null ? "빈칸" : Number(r.want).toLocaleString()}`,
    );
  }

  if (!doFix) {
    console.log("\n(보기만 했음 — 정정하려면 --fix)");
    process.exit(0);
  }

  const done = await db.execute<{ id: number }>(sql`
    UPDATE quote_item qi
    SET margin = CASE WHEN qi.purchase_cost IS NOT NULL
                      THEN (qi.final_price - qi.purchase_cost) * qi.qty END
    WHERE qi.margin IS DISTINCT FROM
          (CASE WHEN qi.purchase_cost IS NOT NULL
                THEN (qi.final_price - qi.purchase_cost) * qi.qty END)
    RETURNING qi.id`);
  console.log(`\n정정 ${done.length}건 완료`);

  const left = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM quote_item qi
    WHERE qi.margin IS DISTINCT FROM
          (CASE WHEN qi.purchase_cost IS NOT NULL
                THEN (qi.final_price - qi.purchase_cost) * qi.qty END)`);
  console.log(`재검사: 불일치 ${Number(left[0]?.n ?? -1)}건`);
  process.exit(0);
}
main();
