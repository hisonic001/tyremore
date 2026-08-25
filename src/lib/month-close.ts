"use server";

/**
 * ⭐ 월 마감 (ERP 구조화 배치4, 사장님 승인 2026-08-25)
 *
 *   달이 끝나고 정리(입금·지출·계산서·자료 검증)가 다 되면 「마감」을 눌러
 *   그 달 숫자를 확정 표시한다. 하드 락은 없다 — 마감된 달을 고치면 배너로
 *   알리고, [마감 풀기]로 언제든 되돌린다 (되돌리기 가능 원칙).
 *
 * 🔴 질의 순차 · LIMIT. 마감 숫자(headline)는 현황 손익과 같은 식으로 계산해
 *    jsonb 로 남긴다 — 수수료는 정산 자료의 실측만 넣는다(추정치 제외).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "./auth";
import { finHealth } from "./fin-health";
import { kstToday, monthRange } from "./ym";
import { CARD_SETTLE_PATTERN_SQL, EXPENSE_IN_PL } from "./expense-cats";
import { TAX_APP_START } from "./tax-recon";

export interface CloseCheck {
  ok: boolean;
  text: string;
  href: string;
}

export interface MonthCloseInfo {
  closed: boolean;
  closedAt: string | null;
  profit: number | null;
}

export async function monthCloseStatus(ym: string): Promise<MonthCloseInfo> {
  const r = await db.execute<{ d: string; headline: unknown }>(sql`
    SELECT to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') d, headline
    FROM month_close WHERE ym = ${ym} LIMIT 1
  `);
  if (!r[0]) return { closed: false, closedAt: null, profit: null };
  const h = r[0].headline as { profit?: number } | null;
  return { closed: true, closedAt: r[0].d, profit: typeof h?.profit === "number" ? h.profit : null };
}

/** 마감 조건 체크리스트 — 미충족 항목은 그 화면으로 가는 링크가 된다 */
export async function closeChecklist(ym: string, healthOk?: boolean): Promise<CloseCheck[]> {
  const { start, nextStart } = monthRange(ym);
  const inMonth = sql`is_active
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  const [dep] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn
    WHERE source = '통장' AND ${inMonth} AND in_amount > 0
      AND recon_status = '미대조' AND category IS NULL
      AND NOT ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
  `);
  const [exp] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn
    WHERE ${inMonth} AND out_amount > 0 AND category IS NULL
  `);
  let taxCheck: CloseCheck;
  if (nextStart <= TAX_APP_START) {
    taxCheck = { ok: true, text: "세금계산서 — 대조 도입 전 달이라 건너뜀", href: "/finance/tax" };
  } else {
    const [tax] = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int n FROM tax_invoice
      WHERE is_active AND recon_status IN ('미대조', '제안')
        AND write_date >= ${start}::date AND write_date < ${nextStart}::date
    `);
    taxCheck = {
      ok: Number(tax.n) === 0,
      text: Number(tax.n) === 0 ? "세금계산서 다 맞춰짐" : `세금계산서 확인 안 됨 ${tax.n}건`,
      href: "/finance/tax",
    };
  }
  const hOk = healthOk ?? (await finHealth()).allOk;

  return [
    {
      ok: Number(dep.n) === 0,
      text: Number(dep.n) === 0 ? "입금 다 정리됨" : `정리 안 된 입금 ${dep.n}건`,
      href: `/finance/deposits?ym=${ym}`,
    },
    {
      ok: Number(exp.n) === 0,
      text: Number(exp.n) === 0 ? "지출 다 분류됨" : `분류 안 된 지출 ${exp.n}건`,
      href: `/finance/expenses?ym=${ym}`,
    },
    taxCheck,
    { ok: hOk, text: hOk ? "자료 검증 ✓" : "자료 검증 경고 있음", href: "/finance" },
  ];
}

/** 마감 당시 손익 머리숫자 — 현황 손익과 같은 식 (수수료는 실측만, 추정 제외) */
async function computeHeadline(ym: string) {
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
  const [cardOut] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND source = '법인카드' AND (category IS NULL OR category IN (${CATS}))
  `);
  const [fee] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(sale_amount - vat_agency - deposit_amount), 0)::bigint s
    FROM card_deposit WHERE is_active AND month = ${ym}
  `);
  const [bankExp] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND source = '통장' AND category IN (${CATS})
  `);
  const e = Number(earned.s);
  const b = Number(bought.s);
  const c = Number(cardOut.s);
  const f = Number(fee.s);
  const x = Number(bankExp.s);
  return { earned: e, bought: b, cardOut: c, fee: f, bankExp: x, profit: e - b - c - f - x };
}

export async function closeMonth(ym: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || session.role !== "owner") return { ok: false, error: "사장님만 할 수 있습니다" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 이상합니다" };
  if (ym >= kstToday().slice(0, 7)) return { ok: false, error: "이 달이 끝난 뒤에 마감할 수 있습니다" };

  const checks = await closeChecklist(ym);
  const bad = checks.filter((c) => !c.ok);
  if (bad.length > 0) return { ok: false, error: `아직 남은 일이 있습니다 — ${bad.map((c) => c.text).join(" · ")}` };

  const headline = await computeHeadline(ym);
  await db.execute(sql`
    INSERT INTO month_close (ym, closed_by, headline)
    VALUES (${ym}, ${session.uid}, ${JSON.stringify(headline)}::jsonb)
    ON CONFLICT (ym) DO NOTHING
  `);
  return { ok: true };
}

export async function reopenMonth(ym: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || session.role !== "owner") return { ok: false, error: "사장님만 할 수 있습니다" };
  await db.execute(sql`DELETE FROM month_close WHERE ym = ${ym}`);
  return { ok: true };
}

/** 폼 액션용 얇은 래퍼 — form action 은 반환값이 없어야 한다 (cancelBatch 전례) */
export async function closeMonthForm(ym: string, _fd: FormData): Promise<void> {
  await closeMonth(ym);
}
export async function reopenMonthForm(ym: string, _fd: FormData): Promise<void> {
  await reopenMonth(ym);
}
