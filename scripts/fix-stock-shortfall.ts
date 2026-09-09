/**
 * ⭐ 미차감 판매 소급 정정 (재고 조사 2026-09-09)
 *
 *   전산 재고가 0일 때 판 판매(예약 시공완료 포함)는 차감이 조용히 빠졌고,
 *   나중에 입고돼도 소급이 없어 앱 재고가 실물보다 부풀었다 (실측 26건).
 *   판정·차감은 정본 catchUpShortSales 하나 — **마지막 실사 이후** 판매만
 *   소급한다 (실사는 실물을 센 것이라 그 전 미차감은 이미 반영됨: 소급하면
 *   이중 차감). 멱등: 소급된 건 미차감이 아니게 되므로 재실행 시 0건.
 *
 * 실행: npx tsx --env-file=.env.local scripts/fix-stock-shortfall.ts        (보기만)
 *       npx tsx --env-file=.env.local scripts/fix-stock-shortfall.ts --fix  (소급 차감)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { catchUpShortSales } from "@/lib/stock-catchup";

async function main() {
  const doFix = process.argv.includes("--fix");

  // 미차감 판매가 있는 상품 전수
  const prods = await db.execute<{ product_id: number; name: string }>(sql`
    WITH need AS (
      SELECT qi.product_id, q.id qid, SUM(qi.qty)::int need
      FROM quote q JOIN quote_item qi ON qi.quote_id = q.id
      WHERE qi.product_id IS NOT NULL AND q.status = '성사'
        AND COALESCE(q.reservation_status, '') IN ('', '시공완료')
      GROUP BY 1, 2
    ), got AS (
      SELECT si.product_id, sm.quote_id qid, SUM(-sm.qty_delta)::int got
      FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
      WHERE sm.type IN ('출고', '반품') GROUP BY 1, 2
    )
    SELECT DISTINCT n.product_id, p.raw_name AS name
    FROM need n LEFT JOIN got g ON g.qid = n.qid AND g.product_id = n.product_id
    JOIN product p ON p.id = n.product_id
    WHERE n.need > COALESCE(g.got, 0)
    ORDER BY n.product_id`);

  if (prods.length === 0) {
    console.log("미차감 판매 0건 — 정리할 것 없음");
    process.exit(0);
  }

  console.log(`── 미차감 판매가 있는 상품 ${prods.length}개 ──`);
  let total = 0;
  for (const p of prods) {
    const r = await catchUpShortSales(Number(p.product_id), undefined, { dryRun: !doFix });
    if (r.notes.length === 0) {
      console.log(`· [${p.product_id}] ${p.name} — 마지막 실사 이전 건만 있어 건너뜀 (실사가 이미 실물 반영)`);
      continue;
    }
    console.log(`· [${p.product_id}] ${p.name}`);
    for (const n of r.notes) console.log(`    ${n}`);
    total += r.caughtUp;
  }
  console.log(doFix ? `\n소급 차감 합계 ${total}본 완료` : `\n(보기만 했음 — 소급 예정 합계 ${total}본, 실행하려면 --fix)`);
  process.exit(0);
}
main();
