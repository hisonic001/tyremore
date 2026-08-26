/**
 * ⭐ 월 손익 정본 (2026 감사 N5, 2026-08-26)
 *
 *   현황 화면과 월 마감(headline)이 같은 손익 식을 **한 함수**로 쓴다 — 전에는 현황이 정산 자료
 *   없는 달에 평균 요율로 수수료를 추정해 더하고 마감은 실측만 써서, 같은 화면에 "남은 돈"이
 *   두 값으로 나란히 떴다.
 *
 *   쓴 돈 = 상품 매입 + 법인카드(미분류·경비 분류만) + 카드 수수료(실측, 없으면 추정) + 통장 경비(분류된 것).
 *   통장 매입대금·카드대금·내부이체·주주거래는 이중 계산이라 뺀다.
 *
 * 🔴 "use server" 아님 — 페이지·마감이 권한 확인 후 부른다. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { EXPENSE_IN_PL } from "./expense-cats";
import { monthRange } from "./ym";

export interface FinPL {
  ym: string;
  /** 번 돈 (판매, 판매일 기준) */
  earned: number;
  /** 상품 매입 (앱 매입 인보이스, 발행일 기준) */
  bought: number;
  /** 법인카드로 쓴 돈 (미분류 + 경비 분류) */
  cardOut: number;
  /** 카드 수수료 실측 (정산 자료) */
  fee: number;
  /** 정산 자료가 없을 때 평균 요율로 추정한 수수료 (실측 있으면 0) */
  feeEstimated: number;
  /** 추정에 쓴 요율 (없으면 null) */
  feeRate: number | null;
  /** 화면·마감이 쓰는 수수료 = 실측 > 0 ? 실측 : 추정 */
  feeShown: number;
  /** 통장 경비 (임차료·인건비 등 분류된 것) */
  bankExp: number;
  /** 이 달 여신협회 승인합 (추정의 밑) */
  assocMonth: number;
  spent: number;
  profit: number;
  /** 앱 판매·매입 기록이 있는 달인가 — 없으면(2025) 손익은 의미가 없다 */
  dataComplete: boolean;
}

export async function finPL(ym: string): Promise<FinPL> {
  const { start, nextStart } = monthRange(ym);
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const inMonth = sql`is_active
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;
  const CATS = sql.join(EXPENSE_IN_PL.map((c) => sql`${c}`), sql`, `);

  const [earned] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(q.total_amount), 0)::bigint s FROM quote q
    WHERE q.status = '성사' AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
  `);
  const [bought] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(total), 0)::bigint s FROM purchase_invoice
    WHERE status <> '취소' AND total IS NOT NULL
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) >= ${start}
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) < ${nextStart}
  `);
  /* 🔴 감사 H2(2026-08-25): 법인카드 지출은 분류를 존중 — 카드로 낸 매입대금이 매입과 두 번 계산되지 않게 */
  const [cardOut] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND source = '법인카드' AND (category IS NULL OR category IN (${CATS}))
  `);
  const [fee] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(sale_amount - vat_agency - deposit_amount), 0)::bigint s
    FROM card_deposit WHERE is_active AND month = ${ym}
  `);
  const [assoc] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(total_amount), 0)::bigint s FROM card_day
    WHERE is_active AND day >= ${start}::date AND day < ${nextStart}::date
  `);
  const [rate] = await db.execute<{ r: string | null }>(sql`
    SELECT (SUM(sale_amount - vat_agency - deposit_amount)::numeric / NULLIF(SUM(sale_amount), 0))::text r
    FROM card_deposit WHERE is_active
  `);
  const [bankExp] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND source = '통장' AND category IN (${CATS})
  `);

  const e = Number(earned.s);
  const b = Number(bought.s);
  const c = Number(cardOut.s);
  const f = Number(fee.s);
  const a = Number(assoc.s);
  const feeRate = rate?.r ? Number(rate.r) : null;
  /* 정산 자료가 없는 달은 평균 요율로 추정 — 8월처럼 정산이 아직 안 나온 달에 수수료 0원이면 손익이 후해 보인다 */
  const feeEstimated = f === 0 && a > 0 && feeRate ? Math.round(a * feeRate) : 0;
  const feeShown = f > 0 ? f : feeEstimated;
  const x = Number(bankExp.s);
  const spent = b + c + feeShown + x;
  return {
    ym,
    earned: e,
    bought: b,
    cardOut: c,
    fee: f,
    feeEstimated,
    feeRate,
    feeShown,
    bankExp: x,
    assocMonth: a,
    spent,
    profit: e - spent,
    dataComplete: e > 0 || b > 0,
  };
}
