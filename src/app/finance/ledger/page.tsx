import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { finHealth } from "@/lib/fin-health";
import { finPL } from "@/lib/fin-pl";
import { kstToday, ymAdd, pickYm } from "@/lib/ym";
import { expenseOpen, payableTotal } from "@/lib/recon-data";
import { receivableTotal } from "@/lib/receivable-total";
import { taxOpenCounts, CASH_LAT, DONE, LIVE } from "@/lib/tax-recon";
import { FinShell } from "@/components/fin/shell";
import { won } from "@/components/fin/money";
import { closeChecklist, closeMonthForm, monthCloseStatus, reopenMonthForm } from "@/lib/month-close";
// ⭐ 손익 세 줄은 「매출 · 비용 · 이익」 (사장님 2단계 답, 2026-09-11) — fin-words 정본
import { W } from "@/lib/fin-words";

export const dynamic = "force-dynamic";

/**
 * ⭐ 장부 — 손익 (돈관리 개편 1단계, 사장님 결정 2026-09-11)
 *
 *   첫 화면(/finance)은 「오늘 · 이번 주 정리 · 이번 달 돈(숫자만)」 세 칸이 됐다.
 *   손익의 **구성 항목과 근거**, 요약 3카드, 계좌·거래 내역, 월 마감은 여기로 옮겼다
 *   — 옛 현황(page.tsx)에서 그대로 가져온 것이고 숫자 식은 finPL 한 벌이라 그대로다.
 *   사장님 답답함 「숫자가 어디서 온 건지」 → 항목마다 「어디서 온 숫자?」 펼치기.
 *
 * 🔴 질의는 순차 — Promise.all 금지. 월 마감은 3단계(이번 주 정리 흐름)로 옮길 때까지 여기.
 */
export default async function FinanceLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/");

  const health = await finHealth();
  const thisYm = kstToday().slice(0, 7);
  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const mc = await monthCloseStatus(ym);
  const closeChecks = !mc.closed ? await closeChecklist(ym, health.allOk) : [];
  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  const inMonth = sql`is_active
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  /* 손익 — 🔴 식은 lib/fin-pl.finPL 한 벌 (마감 headline 과 같은 함수) */
  const pl = await finPL(ym);
  const recv = await receivableTotal();
  const [cov] = await db.execute<{ card_last: string | null; dep_last: string | null; buy_first: string | null }>(sql`
    SELECT (SELECT max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text FROM cash_txn WHERE source = '법인카드' AND is_active) card_last,
           (SELECT max(month) FROM card_deposit WHERE is_active) dep_last,
           (SELECT min(COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')))
              FROM purchase_invoice WHERE status <> '취소') buy_first
  `);
  const payable = await payableTotal();
  const taxBuyOpenRows = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(t.total) FILTER (WHERE ${LIVE} AND NOT ${DONE}), 0)::bigint s
    FROM tax_invoice t ${CASH_LAT}
    WHERE t.is_active AND t.direction = '매입'
      AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date
  `);
  const taxOpenBy = await taxOpenCounts(ym);
  const expOpen = await expenseOpen(ym);
  const [sales] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM quote q WHERE q.status = '성사'
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
  `);

  const sums = await db.execute<{ source: string; in_sum: string; out_sum: string }>(sql`
    SELECT source, COALESCE(SUM(in_amount), 0)::bigint in_sum, COALESCE(SUM(out_amount), 0)::bigint out_sum
    FROM cash_txn WHERE ${inMonth}
      AND COALESCE(category, '') <> '내부이체'
    GROUP BY source LIMIT 5
  `);
  const bank = sums.find((s) => s.source === "통장");
  const [asideIn] = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(rp.amount), 0)::bigint s, count(*)::int n
    FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id
    WHERE q.status = '성사' AND rp.method = '개인계좌'
      AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
  `);
  const accounts = await db.execute<{ source: string; l: string; in_sum: string; out_sum: string; n: number }>(sql`
    SELECT source, account_label l, COALESCE(SUM(in_amount),0)::bigint in_sum,
           COALESCE(SUM(out_amount),0)::bigint out_sum, count(*)::int n
    FROM cash_txn WHERE ${inMonth} GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 20
  `);
  const balances = await db.execute<{ l: string; balance: string; at: string }>(sql`
    SELECT DISTINCT ON (account_label) account_label l, balance::bigint,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') at
    FROM cash_txn
    WHERE source = '통장' AND is_active AND balance IS NOT NULL
    ORDER BY account_label, occurred_at DESC, id DESC LIMIT 10
  `);
  const txns = await db.execute<{
    id: number; source: string; l: string; at: string; description: string; in_amount: number; out_amount: number;
  }>(sql`
    SELECT id, source, account_label l, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           description, in_amount, out_amount
    FROM cash_txn WHERE ${inMonth}
    ORDER BY occurred_at DESC, id DESC LIMIT 60
  `);

  const lastDay = new Date(new Date(nextStart + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const endShown = ym === thisYm ? kstToday() : lastDay;
  const covWarnings: string[] = [];
  if (!cov.card_last || cov.card_last < start) {
    covWarnings.push(`법인카드 내역이 이 달에 없습니다 (마지막 자료 ${cov.card_last ?? "없음"}) — 카드 ${W.cost}이 0원으로 계산됩니다`);
  } else if (cov.card_last < endShown) {
    covWarnings.push(`법인카드 내역이 ${cov.card_last}까지만 올라와 있습니다`);
  }
  if (pl.feeEstimated > 0 && pl.feeRate) {
    covWarnings.push(`카드 수수료는 정산 자료가 아직 없어 평균 요율(${(pl.feeRate * 100).toFixed(2)}%)로 추정한 값입니다`);
  }
  if (pl.bought === 0 && cov.buy_first && start < cov.buy_first.slice(0, 8) + "01") {
    covWarnings.push(`이 달 매입 기록이 없습니다 (앱 매입 기록은 ${cov.buy_first}부터) — ${W.sales}만 잡혀 ${W.profit}이 실제보다 커 보입니다`);
  }
  const gTaxBuyOpen = Number(taxBuyOpenRows[0].s);
  const noData = sums.length === 0;
  const m = Number(ym.slice(5, 7));

  /** 「어디서 온 숫자?」 한 줄 — 구성 항목과 그 목록으로 가는 길 */
  const Why = ({ children }: { children: React.ReactNode }) => (
    <details className="mt-0.5 pl-3 text-xs text-slate-500">
      <summary className="cursor-pointer text-slate-400">어디서 온 숫자?</summary>
      <div className="mt-1 space-y-0.5">{children}</div>
    </details>
  );

  return (
    <FinShell tab="ledger" monthNav={{ ym, basePath: "/finance/ledger" }} closeNotice={false}>
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        <div>
          {/* ── 손익 — 회계어 없이, 이중 계산 없이 ── */}
          <section id="pl" className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4">
            <h2 className="font-bold">{m}월 손익</h2>
            <div className="tabular mt-2 space-y-1 text-sm">
              <div id="earned">
                <p className="flex justify-between">
                  <span>{W.sales}</span>
                  <strong className="text-emerald-700">{won(pl.earnedTotal)}원</strong>
                </p>
                <Why>
                  <p>= 앱 판매 {won(pl.earned)}원 ({sales.n}건, 판매일 기준 — <Link href={`/sales?month=${ym}`} className="underline">정비 내역</Link>)</p>
                  {pl.salesUnrecorded > 0 && <p>+ 앱에 기록 없는 판매 입금(통장 「판매입금」 분류) {won(pl.salesUnrecorded)}원 — <Link href={`/finance/deposits?ym=${ym}`} className="underline">입금</Link></p>}
                  {pl.refunded > 0 && <p>− 돌려준 돈(예약금·환불 분류) {won(pl.refunded)}원 — <Link href={`/finance/expenses?ym=${ym}`} className="underline">지출</Link></p>}
                </Why>
              </div>
              <div id="spent">
                <p className="flex justify-between">
                  <span>{W.cost}</span>
                  <strong className="text-red-600">{won(pl.spent)}원</strong>
                </p>
                <Why>
                  <p>= 상품 매입 {won(pl.bought)}원 (앱 매입 장부, 발행일 기준 — <Link href={`/finance/payables?ym=${ym}`} className="underline">미지급</Link>)</p>
                  <p>+ 법인카드 {W.cost} {won(pl.cardOut)}원 (미분류 + 경비로 분류된 것 — 매입대금·카드대금 분류는 이중이라 뺌 — <Link href={`/finance/expenses?ym=${ym}`} className="underline">지출</Link>)</p>
                  <p>+ 카드 수수료 {won(pl.feeShown)}원 {pl.feeEstimated > 0 ? `(정산 자료 없어 평균 요율 ${((pl.feeRate ?? 0) * 100).toFixed(2)}% 로 추정)` : "(카드사 정산 자료 실측)"} — <Link href={`/finance/card?ym=${ym}`} className="underline">카드</Link></p>
                  <p>+ 통장 경비 {won(pl.bankExp)}원 (임차료·인건비 등 「지출 분류」에서 나눈 것만 — 내부이체·카드대금은 뺌)</p>
                </Why>
              </div>
              <p className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold" id="profit">
                <span>{W.profit}</span>
                <span className={pl.profit >= 0 ? "text-emerald-700" : "text-red-600"}>{won(pl.profit)}원</span>
              </p>
            </div>
            {covWarnings.length > 0 && (
              <div className="mt-3 space-y-0.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                {covWarnings.map((w) => (
                  <p key={w}>⚠️ {w}</p>
                ))}
              </div>
            )}
            {(gTaxBuyOpen > 0 || expOpen.sum > 0) && (
              <div className="tabular mt-3 space-y-0.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                {gTaxBuyOpen > 0 && (
                  <p>
                    이 달 매입 세금계산서 중 {W.open}: {taxOpenBy.buy}건 · {won(gTaxBuyOpen)}원 —{" "}
                    <Link href={`/finance/tax?view=money&ym=${ym}&direction=매입`} className="underline">{W.reconTax}</Link>
                  </p>
                )}
                {expOpen.sum > 0 && (
                  <p>
                    분류 안 된 통장 출금: {won(expOpen.sum)}원 — <Link href={`/finance/expenses?ym=${ym}`} className="underline">지출 분류</Link>에서 나누면 손익이 정확해집니다
                  </p>
                )}
              </div>
            )}
            <p className="tabular mt-1 text-[11px] text-slate-400">
              기준: {W.sales}=판매일 · 매입=발행일 · 카드·경비=사용일 · 수수료=정산월. 통장 잔액과는 원래 다른 숫자입니다(장사 손익).
            </p>
          </section>

          {/* ── 지금 기준 (달과 무관) ── */}
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">
              지금 기준 <span className="text-xs font-normal text-slate-400">— 달과 상관없는 누적</span>
            </h2>
            <div className="tabular mt-2 space-y-1 text-sm">
              <p className="flex justify-between" id="receivable">
                <span>{W.receivable} (잔액 전체)</span>
                <Link href="/receivables" className="font-semibold text-amber-800 underline underline-offset-2">
                  {won(recv.remain)}원
                </Link>
              </p>
              {recv.reserveCount > 0 && (
                <p className="flex justify-between pl-3 text-xs text-slate-500">
                  <span>· 그중 📌 예약 잔금 (시공 때 받는 잔금)</span>
                  <span>{won(recv.reserveRemain)}원 · {recv.reserveCount}건</span>
                </p>
              )}
              <p className="flex justify-between" id="payable">
                <span>{W.payable} (매입 잔액)</span>
                <Link href={`/finance/payables?ym=${ym}`} className="font-semibold text-red-700 underline underline-offset-2">
                  {won(payable)}원
                </Link>
              </p>
            </div>
          </section>
        </div>

        <div>
          {noData && (
            <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              아직 올린 내역이 없습니다 — <Link href="/finance/upload" className="underline">올리기</Link>에서 통장·법인카드 엑셀을 올려 주세요.
            </section>
          )}
          {!noData && (
            <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-xs text-slate-500">통장에 들어온 돈 (계좌끼리 제외)</p>
                <p className="tabular mt-1 font-bold text-emerald-700">{won(Number(bank?.in_sum ?? 0))}원</p>
                {Number(asideIn?.s ?? 0) > 0 && (
                  <p className="tabular mt-0.5 text-[11px] text-emerald-700">
                    + 개인계좌 수금 {won(Number(asideIn.s))}원 <span className="text-slate-400">(통장 밖)</span>
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-xs text-slate-500">통장에서 나간 돈</p>
                <p className="tabular mt-1 font-bold text-red-600">{won(Number(bank?.out_sum ?? 0))}원</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-xs text-slate-500">카드 {W.cost}</p>
                <p className="tabular mt-1 font-bold text-red-600">{won(pl.cardOut)}원</p>
              </div>
            </section>
          )}

          {/* ── 월 마감 (3단계에서 「이번 주 정리」 마지막 단계로 옮길 때까지 여기) ── */}
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4" id="close">
            <h2 className="font-semibold">{m}월 마감</h2>
            {mc.closed ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <p className="text-emerald-800">
                  ✅ 마감됨 ({mc.closedAt})
                  {mc.profit !== null && mc.dataComplete ? (
                    <> — {W.profit} <strong className="tabular">{won(mc.profit)}원</strong>으로 확정</>
                  ) : (
                    <span className="text-slate-500"> — 자료 기준 마감 (앱 판매·매입 기록이 없는 달이라 손익은 없음)</span>
                  )}
                </p>
                <form action={reopenMonthForm.bind(null, ym)}>
                  <button type="submit" className="shrink-0 text-xs text-slate-400 underline">
                    마감 풀기
                  </button>
                </form>
              </div>
            ) : (
              <>
                <ul className="mt-2 space-y-1 text-sm">
                  {closeChecks.map((c) => (
                    <li key={c.key}>
                      {c.ok ? (
                        <span className="text-emerald-700">✓ {c.text}</span>
                      ) : (
                        <Link href={c.href} className={`underline underline-offset-2 ${c.soft ? "text-slate-500" : "text-amber-700"}`}>
                          {c.soft ? "ⓘ" : "⚠"} {c.text} →{c.soft && <span className="text-slate-400"> (참고)</span>}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                {ym >= thisYm ? (
                  <p className="mt-2 text-xs text-slate-400">이 달이 끝나면(다음 달부터) 마감 버튼이 나옵니다 — 위 항목이 전부 ✓면 준비 끝입니다</p>
                ) : closeChecks.length > 0 && closeChecks.filter((c) => !c.soft).every((c) => c.ok) ? (
                  <form action={closeMonthForm.bind(null, ym)} className="mt-2">
                    <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                      이 달 마감하기
                    </button>
                  </form>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">참고(ⓘ) 항목 빼고 전부 ✓가 되면 마감 버튼이 나옵니다</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* ── 계좌·카드별 ── */}
      {accounts.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">계좌·카드별 ({ym})</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {accounts.map((a) => {
              const bal = a.source === "통장" ? balances.find((b) => b.l === a.l) : null;
              return (
                <li key={`${a.source}|${a.l}`} className="flex items-baseline justify-between py-1.5">
                  <span>
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{a.source}</span>
                    {a.l} <span className="text-xs text-slate-400">{a.n}건</span>
                  </span>
                  <span className="tabular text-right">
                    {Number(a.in_sum) !== 0 && <span className="text-emerald-700">+{won(Number(a.in_sum))} </span>}
                    {Number(a.out_sum) !== 0 && <span className="text-red-600">−{won(Number(a.out_sum))}</span>}
                    {bal && (
                      <span className="ml-2 text-xs text-slate-500">
                        잔액 {won(Number(bal.balance))}원 ({bal.at})
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 이번 달 거래 ── */}
      {txns.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">
            {ym} 거래 <span className="text-sm font-normal text-slate-400">최근 {txns.length}줄</span>
            <Link href={`/finance/files?ym=${ym}`} className="ml-2 text-xs font-normal text-slate-500 underline">
              올린 자료 →
            </Link>
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {txns.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="tabular text-xs text-slate-400">{t.at}</span>{" "}
                  <span className="text-xs text-slate-400">{t.source === "법인카드" ? "💳" : "🏦"}</span> {t.description}
                </span>
                <span className="tabular shrink-0">
                  {t.in_amount !== 0 && <span className="text-emerald-700">+{won(t.in_amount)}원</span>}
                  {t.out_amount !== 0 && <span className="text-red-600">−{won(t.out_amount)}원</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-3 text-xs text-slate-400">
        품목별 마진은 <Link href="/reports/margin" className="underline">마진 리포트</Link>에서 따로 봅니다.
      </p>
    </FinShell>
  );
}
