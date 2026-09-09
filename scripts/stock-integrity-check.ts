/**
 * ⭐ 재고 정합 감시기 (재고 조사 2026-09-09 이후 상비)
 *
 *   "재고가 조금씩 달라지는 느낌"이 들면 이것부터 돌린다. 판정 5종:
 *   ① 미차감 — 성사(예약중 제외) 판매인데 재고 차감이 모자람.
 *      단, 그 상품의 **마지막 실사 이전** 판매는 실사가 실물을 반영했으므로
 *      「기록 공백(정상)」으로 따로 센다.
 *   ② 초과 차감 — 판 것보다 많이 빠짐 (이중 차감 사고)
 *   ③ 취소 미복원 — 취소 판매의 출고가 반품으로 상쇄 안 됨
 *   ④ 유령 판매완료 — 판매완료 재고인데 성사 판매에 연결 안 됨
 *   ⑤ 예약 조기 차감 — 예약중인데 이미 출고됨
 *   전부 0건이 정상 (①의 「실사 이전 공백」은 참고용).
 *
 * 실행: npx tsx --env-file=.env.local scripts/stock-integrity-check.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  let bad = 0;

  const shortfall = await db.execute<{
    quote_no: string; d: string; product_id: number; name: string; missing: number; last_audit: string | null;
  }>(sql`
    WITH need AS (
      SELECT q.id qid, q.quote_no,
             COALESCE(q.fulfilled_on, q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) d,
             qi.product_id, SUM(qi.qty)::int need
      FROM quote q JOIN quote_item qi ON qi.quote_id = q.id
      WHERE qi.product_id IS NOT NULL AND q.status = '성사'
        AND COALESCE(q.reservation_status, '') IN ('', '시공완료')
      GROUP BY 1, 2, 3, 4
    ), got AS (
      SELECT sm.quote_id qid, si.product_id, SUM(-sm.qty_delta)::int got
      FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
      WHERE sm.type IN ('출고', '반품') GROUP BY 1, 2
    ), audit AS (
      SELECT si.product_id, max((sm.created_at AT TIME ZONE 'Asia/Seoul')::date) last_audit
      FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
      WHERE sm.reason LIKE '%실사%' OR sm.reason = '엑셀 반영'
      GROUP BY 1
    )
    SELECT n.quote_no, n.d::text, n.product_id, p.raw_name AS name,
           (n.need - COALESCE(g.got, 0)) AS missing, a.last_audit::text
    FROM need n
    LEFT JOIN got g ON g.qid = n.qid AND g.product_id = n.product_id
    LEFT JOIN audit a ON a.product_id = n.product_id
    JOIN product p ON p.id = n.product_id
    WHERE n.need > COALESCE(g.got, 0)
    ORDER BY n.d`);
  const live = shortfall.filter((s) => !s.last_audit || s.d > s.last_audit);
  const gap = shortfall.length - live.length;
  console.log(`① 미차감(마지막 실사 이후 — 진짜 문제): ${live.length}건${gap ? ` · 실사 이전 기록 공백 ${gap}건(정상)` : ""}`);
  for (const s of live) console.log(`   · ${s.quote_no} (${s.d}) ${s.name} ${s.missing}본 — 입고 등록하면 자동 소급, 급하면 fix-stock-shortfall.ts`);
  bad += live.length;

  const over = await db.execute<{ quote_no: string; product_id: number; need: number; got: number }>(sql`
    WITH need AS (
      SELECT q.id qid, q.quote_no, qi.product_id, SUM(qi.qty)::int need
      FROM quote q JOIN quote_item qi ON qi.quote_id = q.id
      WHERE qi.product_id IS NOT NULL AND q.status = '성사'
      GROUP BY 1, 2, 3
    ), got AS (
      SELECT sm.quote_id qid, si.product_id, SUM(-sm.qty_delta)::int got
      FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
      WHERE sm.type IN ('출고', '반품') GROUP BY 1, 2
    )
    SELECT n.quote_no, n.product_id, n.need, g.got
    FROM need n JOIN got g ON g.qid = n.qid AND g.product_id = n.product_id
    WHERE g.got > n.need`);
  console.log(`② 초과 차감(이중 차감): ${over.length}건`);
  for (const o of over) console.log(`   · ${o.quote_no} 상품 ${o.product_id}: 판 것 ${o.need}본, 빠진 것 ${o.got}본`);
  bad += over.length;

  const cancelLeft = await db.execute<{ quote_no: string; product_id: number }>(sql`
    SELECT q.quote_no, si.product_id
    FROM quote q JOIN stock_movement sm ON sm.quote_id = q.id JOIN stock_item si ON si.id = sm.stock_item_id
    WHERE q.status = '취소'
    GROUP BY 1, 2
    HAVING COALESCE(SUM(-sm.qty_delta) FILTER (WHERE sm.type = '출고'), 0)
        <> COALESCE(SUM(sm.qty_delta) FILTER (WHERE sm.type = '반품'), 0)`);
  console.log(`③ 취소 미복원: ${cancelLeft.length}건`);
  for (const c of cancelLeft) console.log(`   · ${c.quote_no} 상품 ${c.product_id}`);
  bad += cancelLeft.length;

  const ghost = await db.execute<{ id: number; product_id: number }>(sql`
    SELECT si.id, si.product_id FROM stock_item si LEFT JOIN quote q ON q.id = si.quote_id
    WHERE si.status = '판매완료' AND (si.quote_id IS NULL OR q.status <> '성사')`);
  console.log(`④ 유령 판매완료: ${ghost.length}건`);
  for (const g of ghost) console.log(`   · 재고행 ${g.id} 상품 ${g.product_id}`);
  bad += ghost.length;

  const early = await db.execute<{ quote_no: string; n: number }>(sql`
    SELECT q.quote_no, count(sm.id)::int n
    FROM quote q JOIN stock_movement sm ON sm.quote_id = q.id AND sm.type = '출고'
    WHERE q.reservation_status = '예약중' GROUP BY 1`);
  console.log(`⑤ 예약 조기 차감: ${early.length}건`);
  for (const e of early) console.log(`   · ${e.quote_no} 출고 ${e.n}건`);
  bad += early.length;

  console.log(bad === 0 ? "\n✅ 전부 정상 — 재고 어긋남 없음" : `\n⚠ 이상 ${bad}건 — 위 목록 확인 필요`);
  process.exit(0);
}
main();
