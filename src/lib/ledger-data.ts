/**
 * ⭐ 장부(/finance/ledger) 조회 모듈 (돈관리 개편 5단계 「정리」, 2026-09-13)
 *
 *   장부 page.tsx 가 인라인으로 들고 있던 SQL 을 여기로 옮겼다 — 화면 파일에 `db`·`sql` 이
 *   남아 있으면 「숫자가 어디서 오나」를 화면 안에서 또 찾아야 한다. 정본 함수가 이미 있는
 *   숫자(finPL·receivableTotal·payableTotal·taxOpenCounts·expenseOpen)는 여기 없다.
 *
 * 🔴 SQL 의미는 옮기기 전과 **그대로** — 화면 숫자를 바꾸는 이관이 아니다.
 *    특히 ledgerOpenBuySum 은 taxOpenCounts(건수, 월정산 거래처 1건 규칙)와 정의가 달라
 *    금액 합을 따로 둔다 — 합치면 「이 달 매입 세금계산서 중 열린 합」이 바뀐다.
 * 🔴 "use server" 아님 — page 가 권한 확인 후 부른다. 질의 순차.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CASH_LAT, DONE, LIVE } from "./tax-recon";
import { monthRange } from "./ym";

/** 자료가 어디까지 올라와 있나 — 손익 아래 ⚠️ 경고의 근거 */
export interface LedgerCoverage {
  /** 법인카드 내역 마지막 날 (YYYY-MM-DD) */
  cardLast: string | null;
  /** 카드사 정산 자료 마지막 달 (YYYY-MM) */
  depLast: string | null;
  /** 앱 매입 기록 첫 날 (YYYY-MM-DD) */
  buyFirst: string | null;
}

export async function ledgerCoverage(): Promise<LedgerCoverage> {
  const [cov] = await db.execute<{ card_last: string | null; dep_last: string | null; buy_first: string | null }>(sql`
    SELECT (SELECT max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text FROM cash_txn WHERE source = '법인카드' AND is_active) card_last,
           (SELECT max(month) FROM card_deposit WHERE is_active) dep_last,
           (SELECT min(COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')))
              FROM purchase_invoice WHERE status <> '취소') buy_first
  `);
  return { cardLast: cov?.card_last ?? null, depLast: cov?.dep_last ?? null, buyFirst: cov?.buy_first ?? null };
}

/** 이 달 매입 세금계산서 중 아직 돈이 안 맞은 것의 금액 합 — LIVE·DONE 정본 조각 그대로 */
export async function ledgerOpenBuySum(ym: string): Promise<number> {
  const { start, nextStart } = monthRange(ym);
  const [r] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(t.total) FILTER (WHERE ${LIVE} AND NOT ${DONE}), 0)::bigint s
    FROM tax_invoice t ${CASH_LAT}
    WHERE t.is_active AND t.direction = '매입'
      AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date
  `);
  return Number(r?.s ?? 0);
}

/* 🔴 아래 넷은 interface 가 아니라 type — db.execute<T> 가 Record<string, unknown> 을 요구해 interface 는 안 맞는다 */
export type LedgerSourceSum = {
  source: string;
  in_sum: string;
  out_sum: string;
};

export type LedgerAccountSum = {
  source: string;
  /** account_label */
  l: string;
  in_sum: string;
  out_sum: string;
  n: number;
};

export type LedgerBalance = {
  l: string;
  balance: string;
  /** MM-DD */
  at: string;
};

export type LedgerTxn = {
  id: number;
  source: string;
  l: string;
  /** MM-DD HH:MI */
  at: string;
  description: string;
  in_amount: number;
  out_amount: number;
};

export interface LedgerMonthSums {
  /** source 별 월합 — 내부이체 제외. 비어 있으면 「아직 올린 내역이 없다」 */
  bySource: LedgerSourceSum[];
  /** 계좌·카드별 월합 (내부이체 포함 — 계좌 단위 흐름은 그대로 보인다) */
  accounts: LedgerAccountSum[];
  /** 통장 계좌별 마지막 잔액 */
  balances: LedgerBalance[];
  /** 이 달 거래 최근 60줄 */
  txns: LedgerTxn[];
  /** 개인계좌로 받은 판매 대금(통장 밖) — 합·건수 */
  asideIn: { s: string; n: number };
}

/**
 * 이 달 통장·카드 합계 묶음. 질의 5개 순차.
 *
 * 🔴 bySource 와 accounts 를 한 질의(GROUP BY source, account_label + FILTER)로 합칠 수도 있지만
 *    두 질의의 LIMIT(5·20)과 「내부이체만 있는 source 는 bySource 에 안 나온다 → noData」 판정이
 *    미묘하게 달라질 수 있어 **둘로 둔다** — 5단계 원칙(화면 숫자 불변)이 질의 하나보다 무겁다.
 */
export async function ledgerMonthSums(ym: string): Promise<LedgerMonthSums> {
  const { start, nextStart } = monthRange(ym);
  const inMonth = sql`is_active
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  const bySource = await db.execute<LedgerSourceSum>(sql`
    SELECT source, COALESCE(SUM(in_amount), 0)::bigint in_sum, COALESCE(SUM(out_amount), 0)::bigint out_sum
    FROM cash_txn WHERE ${inMonth}
      AND COALESCE(category, '') <> '내부이체'
    GROUP BY source LIMIT 5
  `);
  const [asideIn] = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(rp.amount), 0)::bigint s, count(*)::int n
    FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id
    WHERE q.status = '성사' AND rp.method = '개인계좌'
      AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
  `);
  const accounts = await db.execute<LedgerAccountSum>(sql`
    SELECT source, account_label l, COALESCE(SUM(in_amount),0)::bigint in_sum,
           COALESCE(SUM(out_amount),0)::bigint out_sum, count(*)::int n
    FROM cash_txn WHERE ${inMonth} GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 20
  `);
  const balances = await db.execute<LedgerBalance>(sql`
    SELECT DISTINCT ON (account_label) account_label l, balance::bigint,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') at
    FROM cash_txn
    WHERE source = '통장' AND is_active AND balance IS NOT NULL
    ORDER BY account_label, occurred_at DESC, id DESC LIMIT 10
  `);
  const txns = await db.execute<LedgerTxn>(sql`
    SELECT id, source, account_label l, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           description, in_amount, out_amount
    FROM cash_txn WHERE ${inMonth}
    ORDER BY occurred_at DESC, id DESC LIMIT 60
  `);

  return {
    bySource: [...bySource],
    accounts: [...accounts],
    balances: [...balances],
    txns: [...txns],
    asideIn: { s: asideIn?.s ?? "0", n: Number(asideIn?.n ?? 0) },
  };
}
