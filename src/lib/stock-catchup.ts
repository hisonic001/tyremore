import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * ⭐ 입고 따라잡기 — 미차감 판매 소급 차감 정본 (재고 조사 2026-09-09)
 *
 *   매장은 실물이 먼저 시공되고 전산 입고가 나중인 날이 흔하다
 *   (Q26-0829-006: 판매 07:30 → 매입입고 09:47). 그 순간 전산 재고가 0이라
 *   sellFromStock 이 부족분을 조용히 통과시키면, 입고 뒤에도 아무도 소급하지
 *   않아 **앱 재고가 실물보다 부풀었다** (시공완료 미차감 포함 26건 실측).
 *
 *   이 함수가 그 상품의 「빠졌어야 했는데 안 빠진」 성사 판매를 찾아 지금
 *   재고에서 마저 뺀다(movement memo '소급차감', 판매에 연결).
 *
 * 🔴 마지막 실사보다 **뒤의** 판매만 소급한다 — 실사는 실물을 눈으로 센 것이라
 *    그 전의 미차감 판매분은 이미 반영돼 있다. 소급하면 이중 차감이 된다.
 *    실사와 같은 날 판매는 순서를 알 수 없어 보수적으로 건너뛴다.
 */

/** 실사 계열 reason — 이 기록이 있으면 그 시점의 실물 개수가 진실이다 */
const AUDIT_REASON_SQL = sql`(sm.reason LIKE '%실사%' OR sm.reason = '엑셀 반영')`;

export async function catchUpShortSales(
  productId: number,
  userId?: number,
  opts?: { dryRun?: boolean },
): Promise<{ caughtUp: number; notes: string[] }> {
  const [audit] = await db.execute<{ last: string | null }>(sql`
    SELECT max((sm.created_at AT TIME ZONE 'Asia/Seoul')::date)::text AS last
    FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
    WHERE si.product_id = ${productId} AND ${AUDIT_REASON_SQL}
  `);
  const lastAudit = audit?.last ?? null;

  const shorts = await db.execute<{ qid: number; quote_no: string; d: string; missing: number }>(sql`
    WITH need AS (
      SELECT q.id qid, q.quote_no,
             COALESCE(q.fulfilled_on, q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) d,
             SUM(qi.qty)::int need
      FROM quote q JOIN quote_item qi ON qi.quote_id = q.id
      WHERE qi.product_id = ${productId} AND q.status = '성사'
        AND COALESCE(q.reservation_status, '') IN ('', '시공완료')
      GROUP BY 1, 2, 3
    ), got AS (
      SELECT sm.quote_id qid, SUM(-sm.qty_delta)::int got
      FROM stock_movement sm JOIN stock_item si ON si.id = sm.stock_item_id
      WHERE si.product_id = ${productId} AND sm.type IN ('출고', '반품')
      GROUP BY 1
    )
    SELECT n.qid, n.quote_no, n.d::text, (n.need - COALESCE(g.got, 0)) AS missing
    FROM need n LEFT JOIN got g ON g.qid = n.qid
    WHERE n.need > COALESCE(g.got, 0)
      AND (${lastAudit}::date IS NULL OR n.d > ${lastAudit}::date)
    ORDER BY n.d, n.qid
  `);

  let caughtUp = 0;
  const notes: string[] = [];
  if (shorts.length === 0) return { caughtUp, notes };

  if (opts?.dryRun) {
    const [avail] = await db.execute<{ n: number }>(sql`
      SELECT COALESCE(SUM(qty), 0)::int n FROM stock_item WHERE product_id = ${productId} AND status = '재고'`);
    let left = Number(avail?.n ?? 0);
    for (const s of shorts) {
      const missing = Number(s.missing);
      const would = Math.min(missing, Math.max(left, 0));
      left -= would;
      notes.push(
        `${s.quote_no} (${s.d}) ${missing}본 미차감` +
          (would > 0 ? ` → ${would}본 소급 예정` : " → 재고 없어 기록만") +
          (lastAudit ? ` (마지막 실사 ${lastAudit} 이후)` : " (실사 이력 없음)"),
      );
      caughtUp += would;
    }
    return { caughtUp, notes };
  }

  const { sellFromStock } = await import("./sale");
  for (const s of shorts) {
    const missing = Number(s.missing);
    if (missing <= 0) continue;
    const { short } = await sellFromStock(productId, missing, Number(s.qid), userId, db, `소급차감 (${s.quote_no} ${s.d} 판매분)`);
    const done = missing - short;
    if (done > 0) {
      caughtUp += done;
      notes.push(`${s.quote_no} 판매분 ${done}본 소급 차감`);
    }
    if (short > 0) notes.push(`${s.quote_no} ${short}본은 여전히 재고 부족 — 다음 입고 때 다시 시도`);
  }
  return { caughtUp, notes };
}
