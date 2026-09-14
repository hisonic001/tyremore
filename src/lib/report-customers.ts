/**
 * ⭐ 손님 리포트 자료 — `/reports/customers` (2026-09-14 사장님 요청)
 *
 *   보는 것: ① 새 손님 vs 다시 온 손님 ② 손님당 쓰는 돈·방문 횟수(최근 12개월)
 *            ③ 다시 오기까지 걸리는 기간(구간 분포) ④ 오랫동안 안 온 손님(명수만)
 *
 * 🔴 명단은 돌려주지 않는다 — 집계 숫자만 (사장님 확정: 숫자·그래프만).
 * 🔴 질의는 **고정 5개, 하나씩 차례로** — 접속 자리 3개 (D-30).
 *    scripts/check-query-load.ts 에 등록돼 있다.
 *
 * 모집단: 성사 판매 · 실제 판 날(work_date) · 보고 있는 달 말일까지.
 * 방문 = 같은 손님·같은 날은 1번. 금액·날짜는 2025-01 부터 전부 쓴다
 * (MARS 이관분도 날짜·금액은 정확하다 — 품목만 없다).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange, ymAdd, kstToday } from "./ym";
import {
  GAP_BUCKETS,
  LAPSE_BUCKETS,
  SPEND_BUCKETS,
  VISIT_BUCKETS,
  asOfDate,
  type Who,
} from "./report-cv-pure";
import { bucketCols, bucketVals, buyerKeySql, realBuyerSql, saleDate, whoSql } from "./report-cv-sql";

export interface CustomerMonth {
  ym: string;
  newN: number;
  retN: number;
  newAmt: number;
  retAmt: number;
}

export interface CustomerReport {
  ym: string;
  asOf: string;
  winStart: string;
  /** 12개월 창 달별 — 오래된 달부터 12칸 (빈 달도 0으로 채움) */
  months: CustomerMonth[];
  /** 최근 12개월 */
  year: {
    buyers: number;
    amount: number;
    visits: number;
    medianSpend: number;
    top20Amount: number;
    spend: number[];
    visitCounts: number[];
  };
  gaps: { n: number; avgDays: number | null; medianDays: number | null; buckets: number[] };
  lapse: { everBuyers: number; over180: number; buckets: number[] };
  /** 자리표시·고객없음으로 빠진 개인 판매 (12개월) — 각주용 */
  excludedSales: number;
}

export async function customerReportData(ym: string, who: Who): Promise<CustomerReport> {
  const { nextStart } = monthRange(ym);
  const winStart = `${ymAdd(ym, -11)}-01`;
  const asOf = asOfDate(ym, kstToday());
  const D = saleDate("q");

  /** 판매 한 줄 = (누가, 언제, 얼마) — 다섯 질의가 같은 모집단을 본다 */
  const base = sql`
    SELECT ${buyerKeySql("q")} k, ${D} d, q.total_amount amt
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND ${whoSql(who, "q")} AND ${realBuyerSql("q", "c")}
      AND ${D} < ${nextStart}::date`;

  // ① 달별 새/다시 — 「새」 = 그 달이 첫 성사 (매출 리포트 guests 식과 같은 뜻)
  const monthRows = await db.execute<{ ym: string; new_n: number; ret_n: number; new_amt: string; ret_amt: string }>(sql`
    WITH b AS (${base}), f AS (SELECT k, min(d) fd FROM b GROUP BY k)
    SELECT to_char(b.d, 'YYYY-MM') ym,
           count(DISTINCT b.k) FILTER (WHERE f.fd >= date_trunc('month', b.d)::date)::int new_n,
           count(DISTINCT b.k) FILTER (WHERE f.fd <  date_trunc('month', b.d)::date)::int ret_n,
           COALESCE(SUM(b.amt) FILTER (WHERE f.fd >= date_trunc('month', b.d)::date), 0)::bigint new_amt,
           COALESCE(SUM(b.amt) FILTER (WHERE f.fd <  date_trunc('month', b.d)::date), 0)::bigint ret_amt
    FROM b JOIN f USING (k)
    WHERE b.d >= ${winStart}::date
    GROUP BY 1`);

  // ② 최근 12개월 한 사람당
  const yearRows = await db.execute<Record<string, unknown>>(sql`
    WITH b AS (${base}),
    per AS (
      SELECT k, count(DISTINCT d)::int visits, SUM(amt)::bigint amt
      FROM b WHERE d >= ${winStart}::date GROUP BY k
    ),
    r AS (SELECT per.*, row_number() OVER (ORDER BY amt DESC) rn, count(*) OVER () cnt FROM per)
    SELECT count(*)::int buyers,
           COALESCE(SUM(amt), 0)::bigint amount,
           COALESCE(SUM(visits), 0)::int visits,
           COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY amt), 0)::bigint median_spend,
           COALESCE(SUM(amt) FILTER (WHERE rn <= ceil(cnt * 0.2)), 0)::bigint top20_amount,
           ${bucketCols(sql`amt`, SPEND_BUCKETS, "s")},
           ${bucketCols(sql`visits`, VISIT_BUCKETS, "v")}
    FROM r`);

  // ③ 다시 오기까지 — 한 사람의 연속 방문 사이 날 수 (전 기간)
  const gapRows = await db.execute<Record<string, unknown>>(sql`
    WITH b AS (${base}),
    v AS (SELECT DISTINCT k, d FROM b),
    g AS (SELECT (d - lag(d) OVER (PARTITION BY k ORDER BY d))::int gap FROM v)
    SELECT count(*)::int n,
           avg(gap)::float avg_days,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY gap)::float median_days,
           ${bucketCols(sql`gap`, GAP_BUCKETS, "g")}
    FROM g WHERE gap IS NOT NULL`);

  // ④ 마지막 방문 뒤 지난 날 (기준일 = 이번 달이면 오늘, 지난 달이면 그 달 말일)
  const lapseRows = await db.execute<Record<string, unknown>>(sql`
    WITH b AS (${base}),
    l AS (SELECT k, (${asOf}::date - max(d))::int since FROM b GROUP BY k)
    SELECT count(*)::int ever,
           count(*) FILTER (WHERE since > 180)::int over180,
           ${bucketCols(sql`since`, LAPSE_BUCKETS, "l")}
    FROM l`);

  // ⑤ 뺀 판매 — 개인 판매인데 한 사람으로 못 세는 것 (각주)
  const exRows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND ${whoSql(who, "q")} AND NOT ${realBuyerSql("q", "c")}
      AND ${D} >= ${winStart}::date AND ${D} < ${nextStart}::date`);

  const byYm = new Map(monthRows.map((m) => [m.ym, m]));
  const months: CustomerMonth[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = ymAdd(ym, -i);
    const m = byYm.get(k);
    months.push({
      ym: k,
      newN: Number(m?.new_n ?? 0),
      retN: Number(m?.ret_n ?? 0),
      newAmt: Number(m?.new_amt ?? 0),
      retAmt: Number(m?.ret_amt ?? 0),
    });
  }

  const y = yearRows[0];
  const g = gapRows[0];
  const l = lapseRows[0];
  const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    ym,
    asOf,
    winStart,
    months,
    year: {
      buyers: Number(y?.buyers ?? 0),
      amount: Number(y?.amount ?? 0),
      visits: Number(y?.visits ?? 0),
      medianSpend: Number(y?.median_spend ?? 0),
      top20Amount: Number(y?.top20_amount ?? 0),
      spend: bucketVals(y, SPEND_BUCKETS, "s"),
      visitCounts: bucketVals(y, VISIT_BUCKETS, "v"),
    },
    gaps: {
      n: Number(g?.n ?? 0),
      avgDays: numOrNull(g?.avg_days),
      medianDays: numOrNull(g?.median_days),
      buckets: bucketVals(g, GAP_BUCKETS, "g"),
    },
    lapse: {
      everBuyers: Number(l?.ever ?? 0),
      over180: Number(l?.over180 ?? 0),
      buckets: bucketVals(l, LAPSE_BUCKETS, "l"),
    },
    excludedSales: Number(exRows[0]?.n ?? 0),
  };
}
