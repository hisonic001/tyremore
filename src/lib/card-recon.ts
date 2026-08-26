/**
 * ⭐ 카드 매출 맞추기 — 날짜별 합계 정본 (2026 감사 R4, 2026-08-26)
 *
 *   여신협회 「일별 승인」 vs 앱 카드 매출(카드 단일 + 혼합의 카드 몫 + 외상 카드 수금)을 날짜별로.
 *   🔴 여신 자료가 끝난 날(assocLast) 이후는 비교할 수 없는 날이다 — 전엔 8/24~26 앱 매출이
 *      전부 「차이 난 날」로 잡혀 569만원 가짜 차이가 떴다. 그 날들은 따로 센다.
 *   카드 화면과 현황 마감 체크리스트가 이 함수를 같이 쓴다.
 *
 * 🔴 "use server" 아님. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange } from "./ym";

export interface CardDayRow {
  assoc: number;
  cnt: number;
  cancelled: number;
  app: number;
  /** 승인합의 원천 — 여신협회 / 토스 포스(여신 자료 없는 날) / 없음 */
  src: "여신" | "POS" | null;
}

export interface CardDaySums {
  /** 날짜 오름차순 */
  dayRows: [string, CardDayRow][];
  sumAssoc: number;
  sumApp: number;
  /** 여신 자료가 있는 날 중 차이 난 날 수 */
  diffDays: number;
  /** 이 달 여신 자료 마지막 날 (없으면 null) */
  assocLast: string | null;
  /** 여신 자료 이후 날짜의 앱 카드 매출 (비교 불가) */
  afterCutoffDays: number;
  afterCutoffApp: number;
}

export async function cardDaySums(ym: string): Promise<CardDaySums> {
  const { start, nextStart } = monthRange(ym);
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;

  const assoc = await db.execute<{ d: string; total: number; cnt: number; cancelled: number }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') d, total_amount total, total_cnt cnt, cancelled_amount cancelled
    FROM card_day WHERE is_active AND day >= ${start}::date AND day < ${nextStart}::date
    ORDER BY day LIMIT 40
  `);
  const appDan = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, SUM(q.total_amount)::bigint amt
    FROM quote q WHERE q.status = '성사' AND q.payment_method = '카드'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);
  const appSplit = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, SUM(pm.amount)::bigint amt
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id
    WHERE q.status = '성사' AND pm.method = '카드'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);
  const appColl = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(rp.paid_on, 'YYYY-MM-DD') d, SUM(rp.amount)::bigint amt
    FROM receivable_payment rp
    WHERE rp.method = '카드' AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);

  /* ⭐ 토스 포스 일별 카드 합 (2026-08-26) — 여신협회 자료가 아직 없는 날은 POS 를 승인합으로 쓴다
     (8/24~26 공백이 이걸로 메워진다). 여신이 있는 날은 여신이 정본(승인번호·월 정산과 이어짐). */
  const pos = await db.execute<{ d: string; total: string; cnt: number }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') d, COALESCE(SUM(amount), 0)::bigint total,
           count(*) FILTER (WHERE amount > 0)::int cnt
    FROM pos_txn WHERE is_active AND method = '카드' AND day >= ${start}::date AND day < ${nextStart}::date
    GROUP BY 1 ORDER BY 1 LIMIT 40
  `);
  const appMap = new Map<string, number>();
  for (const r of [...appDan, ...appSplit, ...appColl]) appMap.set(r.d, (appMap.get(r.d) ?? 0) + Number(r.amt));
  const days = new Map<string, CardDayRow>();
  for (const a of assoc) days.set(a.d, { assoc: Number(a.total), cnt: Number(a.cnt), cancelled: Number(a.cancelled), app: 0, src: "여신" });
  for (const p of pos) {
    if (!days.has(p.d)) days.set(p.d, { assoc: Number(p.total), cnt: Number(p.cnt), cancelled: 0, app: 0, src: "POS" });
  }
  for (const [d, amt] of appMap) {
    const row = days.get(d) ?? { assoc: 0, cnt: 0, cancelled: 0, app: 0, src: null };
    row.app = amt;
    days.set(d, row);
  }
  const dayRows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const assocLast = assoc.length > 0 ? assoc[assoc.length - 1].d : null;
  const sumAssoc = dayRows.reduce((s, [, r]) => s + r.assoc, 0);
  const sumApp = dayRows.reduce((s, [, r]) => s + r.app, 0);
  const comparable = ([, r]: [string, CardDayRow]) => r.src !== null;
  const diffDays = dayRows.filter((x) => comparable(x) && x[1].assoc !== x[1].app).length;
  const after = dayRows.filter((x) => !comparable(x));
  return {
    dayRows,
    sumAssoc,
    sumApp,
    diffDays,
    assocLast,
    afterCutoffDays: after.length,
    afterCutoffApp: after.reduce((s, [, r]) => s + r.app, 0),
  };
}
