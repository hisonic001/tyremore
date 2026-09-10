import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * ⭐ 재고 정합 판정 정본 (2026-09-10 추출 — 원래 scripts/stock-integrity-check.ts 안)
 *
 *   감시기 스크립트와 「자료 사진」(ops-snapshot)이 **같은 판정**을 써야 한다.
 *   질의를 복붙하면 한쪽만 고쳐져 두 숫자가 갈라지고, 그러면 사장님은 둘 다
 *   못 믿는다 (외상 장부에서 이미 겪은 교훈).
 *
 *   판정 5종 — 전부 0건이 정상:
 *     ① 미차감 — 판 것보다 재고가 덜 빠짐. 단 그 상품의 **마지막 실사 이전**
 *        판매는 실사가 실물을 반영했으므로 「기록 공백(정상)」으로 따로 센다.
 *     ② 초과 차감 — 판 것보다 많이 빠짐 (이중 차감 사고)
 *     ③ 취소 미복원 — 취소 판매의 출고가 반품으로 안 상쇄됨
 *     ④ 유령 판매완료 — 판매완료 재고인데 성사 판매에 안 붙음
 *     ⑤ 예약 조기 차감 — 예약중인데 이미 출고됨
 */

export interface StockShortfall {
  quoteNo: string;
  date: string;
  productId: number;
  name: string;
  missing: number;
  /** 마지막 실사 이후면 진짜 문제, 이전이면 기록 공백(정상) */
  afterAudit: boolean;
}

export interface StockIntegrity {
  shortfall: StockShortfall[];
  /** 마지막 실사 이후 — 진짜 문제 */
  shortfallLive: StockShortfall[];
  overDeducted: { quoteNo: string; productId: number; need: number; got: number }[];
  cancelNotRestored: { quoteNo: string; productId: number }[];
  ghostSold: { stockItemId: number; productId: number }[];
  reservedDeducted: { quoteNo: string; n: number }[];
  /** 진짜 문제 총 건수 — 0 이 정상 */
  badCount: number;
}

export async function stockIntegrity(): Promise<StockIntegrity> {
  /* 🔴 질의는 하나씩 차례로 — Promise.all 금지 (2026-08-11 마비 사고) */
  const shortfallRows = await db.execute<{
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
  const shortfall: StockShortfall[] = shortfallRows.map((s) => ({
    quoteNo: s.quote_no,
    date: s.d,
    productId: Number(s.product_id),
    name: s.name,
    missing: Number(s.missing),
    afterAudit: !s.last_audit || s.d > s.last_audit,
  }));

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

  const cancelLeft = await db.execute<{ quote_no: string; product_id: number }>(sql`
    SELECT q.quote_no, si.product_id
    FROM quote q JOIN stock_movement sm ON sm.quote_id = q.id JOIN stock_item si ON si.id = sm.stock_item_id
    WHERE q.status = '취소'
    GROUP BY 1, 2
    HAVING COALESCE(SUM(-sm.qty_delta) FILTER (WHERE sm.type = '출고'), 0)
        <> COALESCE(SUM(sm.qty_delta) FILTER (WHERE sm.type = '반품'), 0)`);

  const ghost = await db.execute<{ id: number; product_id: number }>(sql`
    SELECT si.id, si.product_id FROM stock_item si LEFT JOIN quote q ON q.id = si.quote_id
    WHERE si.status = '판매완료' AND (si.quote_id IS NULL OR q.status <> '성사')`);

  const early = await db.execute<{ quote_no: string; n: number }>(sql`
    SELECT q.quote_no, count(sm.id)::int n
    FROM quote q JOIN stock_movement sm ON sm.quote_id = q.id AND sm.type = '출고'
    WHERE q.reservation_status = '예약중' GROUP BY 1`);

  const shortfallLive = shortfall.filter((s) => s.afterAudit);
  return {
    shortfall,
    shortfallLive,
    overDeducted: over.map((o) => ({
      quoteNo: o.quote_no, productId: Number(o.product_id), need: Number(o.need), got: Number(o.got),
    })),
    cancelNotRestored: cancelLeft.map((c) => ({ quoteNo: c.quote_no, productId: Number(c.product_id) })),
    ghostSold: ghost.map((g) => ({ stockItemId: Number(g.id), productId: Number(g.product_id) })),
    reservedDeducted: early.map((e) => ({ quoteNo: e.quote_no, n: Number(e.n) })),
    badCount:
      shortfallLive.length + over.length + cancelLeft.length + ghost.length + early.length,
  };
}
