/**
 * ⭐ 카드 매출 맞추기 — 날짜별 합계 정본 (2026 감사 R4, 2026-08-26)
 *
 *   ⭐ 2026-08-29 개편 (사장님 요청 — "토스POS 매출 리포트는 별개로 열이 추가되어야함")
 *   세 자료를 **나란히** 놓는다. 전엔 토스POS 가 「여신 자료가 없는 날만 대신 채우는 폴백」이라
 *   두 자료를 견줄 수가 없었다.
 *
 *   | 자료 | 무엇 | 간편결제 |
 *   |---|---|---|
 *   | 여신협회 승인 (card_day) | 카드사가 승인한 금액 — 카드사 정산·세무로 이어짐 | ❌ 안 잡힘 |
 *   | 토스POS 결제 (pos_txn)   | 실제로 단말기에서 긁힌 돈                     | ✅ QR결제로 잡힘 |
 *   | 앱 판매 (quote…)         | 우리가 적은 것                                | ✅ 간편결제 |
 *
 *   🔴 차이는 **POS − 앱**으로 잰다. POS 가 실제로 긁힌 돈이고 간편결제까지 들어 있다.
 *      POS 자료가 없는 날만 여신 − 앱. 둘 다 없으면 「자료 없음」(비교 불가).
 *   🔴 비교 가능 여부는 `base` 하나로 내려보낸다 — 전엔 화면이 따로 판정해서
 *      card-recon 의 diffDays 와 화면 회색 처리가 어긋났다.
 *
 * 🔴 "use server" 아님. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange } from "./ym";
import { RECON_METHODS, RECON_POS_METHODS } from "./pos-vocab";

export interface CardDayRow {
  /** 여신협회 승인합 — 자료가 없는 날은 null */
  assoc: number | null;
  assocCnt: number;
  cancelled: number;
  /** 토스POS 결제합 (카드 + 간편결제) — 자료가 없는 날은 null */
  pos: number | null;
  posCard: number;
  posEasy: number;
  /** 앱 매출합 (카드 + 간편결제) */
  app: number;
  appCard: number;
  appEasy: number;
  /** 차이를 무엇으로 잴지 — 둘 다 없으면 null(비교 불가) */
  base: "POS" | "여신" | null;
}

export interface CardDaySums {
  /** 날짜 오름차순 */
  dayRows: [string, CardDayRow][];
  sumAssoc: number;
  sumPos: number;
  sumApp: number;
  /** 비교할 수 있는 날 중 차이 난 날 수 */
  diffDays: number;
  /** 이 달 여신 자료 마지막 날 (없으면 null) */
  assocLast: string | null;
  /** 비교할 자료가 아예 없는 날 */
  afterCutoffDays: number;
  afterCutoffApp: number;
  /** 이 달 간편결제 — 여신협회에는 안 잡히는 몫 (차이 해석의 힌트) */
  easyDays: number;
  easyApp: number;
  easyPos: number;
}

/** 그 행의 차이 (비교 불가면 null) */
export function cardDiff(r: CardDayRow): number | null {
  if (r.base === "POS") return (r.pos ?? 0) - r.app;
  if (r.base === "여신") return (r.assoc ?? 0) - r.app;
  return null;
}

export async function cardDaySums(ym: string): Promise<CardDaySums> {
  const { start, nextStart } = monthRange(ym);
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const M = sql.join((RECON_METHODS as readonly string[]).map((m) => sql`${m}`), sql`, `);

  const assoc = await db.execute<{ d: string; total: number; cnt: number; cancelled: number }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') d, total_amount total, total_cnt cnt, cancelled_amount cancelled
    FROM card_day WHERE is_active AND day >= ${start}::date AND day < ${nextStart}::date
    ORDER BY day LIMIT 40
  `);

  /* ⭐ 토스POS 일별 — 카드와 간편결제(QR결제·선불지급수단)를 갈라서 센다.
     취소는 음수로 들어와 있어 그대로 더하면 상쇄된다 (2026-08-28 실측 QR 취소 2쌍). */
  const pos = await db.execute<{ d: string; card: string; easy: string }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') d,
           COALESCE(SUM(amount) FILTER (WHERE method = '카드'), 0)::bigint card,
           COALESCE(SUM(amount) FILTER (WHERE method IN (${sql.join(
             RECON_POS_METHODS.filter((m) => m !== "카드").map((m) => sql`${m}`),
             sql`, `,
           )})), 0)::bigint easy
    FROM pos_txn WHERE is_active AND method IN (${sql.join(RECON_POS_METHODS.map((m) => sql`${m}`), sql`, `)})
      AND day >= ${start}::date AND day < ${nextStart}::date
    GROUP BY 1 ORDER BY 1 LIMIT 40
  `);

  // 앱 — 단일 판매 · 분할 몫 · 외상 카드수금. 수단별로 갈라 센다
  const appDan = await db.execute<{ d: string; m: string; amt: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, q.payment_method m, SUM(q.total_amount)::bigint amt
    FROM quote q WHERE q.status = '성사' AND q.payment_method IN (${M})
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1, 2 LIMIT 80
  `);
  /* ⭐ 분할 몫의 날짜 = 받은 날(paid_on) 우선 (예약거래 2026-09-01) — 없으면 작업일 */
  const appSplit = await db.execute<{ d: string; m: string; amt: string }>(sql`
    SELECT to_char(COALESCE(pm.paid_on, ${D}), 'YYYY-MM-DD') d, pm.method m, SUM(pm.amount)::bigint amt
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id
    WHERE q.status = '성사' AND pm.method IN (${M})
      AND COALESCE(pm.paid_on, ${D}) >= ${start}::date AND COALESCE(pm.paid_on, ${D}) < ${nextStart}::date
    GROUP BY 1, 2 LIMIT 80
  `);
  /* 🔴 외상 수금은 그 판매가 아직 「외상」일 때만 — 결제수단을 카드로 바꾼 뒤에도 세면
     같은 돈이 판매와 수금으로 두 번 잡힌다 (사장님 제보 2026-08-29 · 홍동식 88,000원) */
  const appColl = await db.execute<{ d: string; m: string; amt: string }>(sql`
    SELECT to_char(rp.paid_on, 'YYYY-MM-DD') d, rp.method m, SUM(rp.amount)::bigint amt
    FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id
    WHERE rp.method IN (${M}) AND q.payment_method = '외상'
      AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
    GROUP BY 1, 2 LIMIT 80
  `);

  const blank = (): CardDayRow => ({
    assoc: null, assocCnt: 0, cancelled: 0,
    pos: null, posCard: 0, posEasy: 0,
    app: 0, appCard: 0, appEasy: 0,
    base: null,
  });
  const days = new Map<string, CardDayRow>();
  const at = (d: string) => {
    const r = days.get(d) ?? blank();
    days.set(d, r);
    return r;
  };

  for (const a of assoc) {
    const r = at(a.d);
    r.assoc = Number(a.total);
    r.assocCnt = Number(a.cnt);
    r.cancelled = Number(a.cancelled);
  }
  for (const p of pos) {
    const r = at(p.d);
    r.posCard = Number(p.card);
    r.posEasy = Number(p.easy);
    r.pos = r.posCard + r.posEasy;
  }
  for (const x of [...appDan, ...appSplit, ...appColl]) {
    const r = at(x.d);
    const v = Number(x.amt);
    r.app += v;
    if (x.m === "간편결제") r.appEasy += v;
    else r.appCard += v;
  }
  for (const r of days.values()) r.base = r.pos !== null ? "POS" : r.assoc !== null ? "여신" : null;

  const dayRows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const assocLast = assoc.length > 0 ? assoc[assoc.length - 1].d : null;
  const sumAssoc = dayRows.reduce((s, [, r]) => s + (r.assoc ?? 0), 0);
  const sumPos = dayRows.reduce((s, [, r]) => s + (r.pos ?? 0), 0);
  const sumApp = dayRows.reduce((s, [, r]) => s + r.app, 0);
  const diffDays = dayRows.filter(([, r]) => cardDiff(r) !== null && cardDiff(r) !== 0).length;
  const after = dayRows.filter(([, r]) => r.base === null);
  const easy = dayRows.filter(([, r]) => r.appEasy > 0 || r.posEasy > 0);

  return {
    dayRows,
    sumAssoc,
    sumPos,
    sumApp,
    diffDays,
    assocLast,
    afterCutoffDays: after.length,
    afterCutoffApp: after.reduce((s, [, r]) => s + r.app, 0),
    easyDays: easy.length,
    easyApp: dayRows.reduce((s, [, r]) => s + r.appEasy, 0),
    easyPos: dayRows.reduce((s, [, r]) => s + r.posEasy, 0),
  };
}
