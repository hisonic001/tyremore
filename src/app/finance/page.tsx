import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { finPL } from "@/lib/fin-pl";
import { kstToday, pickYm, ymAdd } from "@/lib/ym";
import { payableTotal } from "@/lib/recon-data";
import { receivableTotal } from "@/lib/receivable-total";
import { todayBrief } from "@/lib/today-brief";
import { weeklySteps } from "@/lib/weekly-steps";
import { weeklyDoneAt } from "@/lib/app-setting";
import { freshAuditRun } from "@/lib/self-audit";
import { finInbox } from "@/lib/fin-inbox";
import { posDayData } from "@/lib/pos-close";
import { AuditBanner } from "./audit-banner";
import { InboxSection } from "./inbox-ui";
import { TodayCardInline } from "./today-card";
import { InvoiceSkipButton, TransferRow } from "./today-actions";
import { FinShell } from "@/components/fin/shell";
import { won } from "@/components/fin/money";
import { W } from "@/lib/fin-words";
import { closedDelta } from "@/lib/fin-activity";

export const dynamic = "force-dynamic";

/**
 * ⭐ 돈 관리 첫 화면 — 「오늘 · 이번 주 정리 · 이번 달 돈」 세 칸 (돈관리 개편 1단계, 2026-09-11)
 *
 *   사장님 결정(질문 5라운드): 리듬은 매일 저녁 5분 + 주 1회 정리, 첫 화면은 A2 「세 칸 나란히 —
 *   직관적이고 한눈에」. 한 줄 = 무엇 · 숫자 · 단추 하나, 상태는 색(✅ 끝 / 🟡 할 것 / ⚪ 때 아님).
 *   손익의 구성·근거·요약·내역·마감은 장부 첫 화면(/finance/ledger)으로 옮겼다.
 *   정합성 A1(안 들어온 이체)·인박스·추적이 세 곳에서 보여 주던 같은 건은 「오늘」 칸 한 곳으로.
 *
 * 🔴 질의는 순차 — Promise.all 금지. 인라인 SQL 없음 — 정본 today-brief·weekly-steps·finPL·
 *    receivable-total·payableTotal·closedDelta·posDayData 만 부른다.
 * 🔴 posDayData 는 순차 12~19질의라 **조건부로만** 부른다 (4단계, 2026-09-12) — 오늘 POS 자료가
 *    있고 · 아직 마감 안 했고 · 남은 건이 있을 때. 그 세 가지는 today-brief 가 이미 읽은 값이다.
 * 🔴 화면 글자는 fin-words 의 W — 「번 돈·쓴 돈·남은 돈」 → 매출·비용·이익, 못 받은 돈 → 미수금, 줄 돈 → 미지급금 (2단계, ERP 용어).
 */

const manwon = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만`;

function Mark({ warn, idle }: { warn: boolean; idle?: boolean }) {
  return <span className="shrink-0">{idle ? "⚪" : warn ? "🟡" : "✅"}</span>;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const today = kstToday();
  const m = Number(ym.slice(5, 7));

  const brief = await todayBrief();
  const weekly = await weeklySteps(ym);
  const lastDone = await weeklyDoneAt(); // 「이번 주 정리 끝 ✓」 마지막 날 (3단계, 2026-09-12)
  const pl = await finPL(ym);
  const recv = await receivableTotal();
  const payable = await payableTotal();
  const audit = await freshAuditRun();
  const inbox = await finInbox(ym);
  /* ⭐ 마감 뒤 고침 띠 (사장님 결정 15) — 지난달·이번 달 중 마감된 달에 after_close 줄이 있을 때만. 순차 */
  const delta = (await closedDelta(ymAdd(ym, -1))) ?? (await closedDelta(ym));

  const c = brief.card;
  /* ⭐ 카드 마감 인라인 (4단계) — 남은 건을 첫 화면에서 바로 정리한다. 무거운 조회라 조건부·순차 */
  const pos = c.hasPos && !c.closed && c.open > 0 ? await posDayData(today) : null;
  const cardWarn = !c.hasPos || !c.closed || c.open > 0;
  const cardText = !c.hasPos
    ? "오늘 POS 자료 없음"
    : c.open > 0
      ? `${c.open}건 다름`
      : c.closed
        ? `POS ${won(c.posCard)} = 앱 ${won(c.appCard)}`
        : "다 맞음 — 마감만";
  const todayLabel = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`;
  const deadline = brief.deadline;
  const box = "rounded-2xl border border-slate-200 bg-white p-4";
  const row = "flex items-baseline gap-2 py-1 text-sm";
  const goBtn = "ml-auto shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700";
  const okBtn = "ml-auto shrink-0 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700";

  return (
    <FinShell tab="home" monthNav={{ ym, basePath: "/finance" }} closeNotice={false}>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-start">
        {/* ── ① 오늘 ── */}
        <section className={box}>
          <h2 className="flex items-baseline justify-between font-bold">
            오늘 <span className="text-sm font-normal text-slate-400">{todayLabel}</span>
          </h2>
          <ul className="mt-1 divide-y divide-slate-100">
            <li className="py-1 text-sm">
              <div className="flex items-baseline gap-2">
                <Mark warn={cardWarn} />
                <span className="min-w-0">
                  <span className="font-medium">카드 마감</span>
                  <span className="tabular ml-1.5 text-slate-500">{cardText}</span>
                  {/* ⭐ 4단계(2026-09-12): 안 된 날이 있으면 그 중 **다음 날로 바로** 간다 (정본 nextOpenDay) */}
                  {c.otherOpenDays > 0 &&
                    (c.nextOpenDay ? (
                      <Link
                        href={`/finance/card?ym=${c.nextOpenDay.slice(0, 7)}&d=${c.nextOpenDay}`}
                        className="tabular ml-1 text-xs text-amber-700 underline underline-offset-2"
                      >
                        · 안 된 날 {c.otherOpenDays}일 →
                      </Link>
                    ) : (
                      <span className="tabular ml-1 text-xs text-amber-700">· 안 된 날 {c.otherOpenDays}일</span>
                    ))}
                </span>
                <Link href={`/finance/card?ym=${today.slice(0, 7)}&d=${today}`} className={cardWarn ? goBtn : okBtn}>
                  {cardWarn ? (c.hasPos ? `${W.recon} →` : "올리기 →") : "마감됨"}
                </Link>
              </div>
              {/* ⭐ 올리기 · 남은 건 대조 · 마감을 이 자리에서 (사장님 결정 4) */}
              <TodayCardInline today={today} card={c} data={pos} />
            </li>
            <li className="py-1 text-sm">
              <div className="flex items-baseline gap-2">
                <Mark warn={brief.transfers.length > 0} />
                <span className="font-medium">안 들어온 이체</span>
                <span className="tabular text-slate-500">
                  {brief.transfers.length > 0 ? `${brief.transfers.length}건 · ${manwon(brief.transfers.reduce((s, t) => s + t.total, 0))}` : "없음"}
                </span>
              </div>
              {brief.transfers.length > 0 && (
                <ul className="mt-1 divide-y divide-slate-100 pl-6">
                  {brief.transfers.slice(0, 5).map((t) => (
                    <TransferRow key={t.quoteId} t={t} />
                  ))}
                  {brief.transfers.length > 5 && (
                    <li className="pt-1 text-xs">
                      <Link href="/finance/trace" className="text-slate-500 underline">
                        나머지 {brief.transfers.length - 5}건 →
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </li>
            <li className="py-1 text-sm">
              <div className="flex items-baseline gap-2">
                <Mark warn={false} />
                <span className="font-medium">오늘 생긴 {W.receivable}</span>
                <span className="tabular text-slate-500">
                  {brief.newReceivables.length > 0 ? `${brief.newReceivables.length}건 · ${manwon(brief.newReceivables.reduce((s, r) => s + r.remain, 0))}` : "오늘 생긴 것 없음"}
                </span>
              </div>
              {brief.newReceivables.length > 0 && (
                <ul className="mt-1 pl-6 text-xs text-slate-600">
                  {brief.newReceivables.map((r) => (
                    <li key={r.quoteId} className="flex items-baseline justify-between gap-2 py-0.5">
                      <span className="min-w-0 truncate">
                        {r.kind === "reserve" ? "📌 " : r.kind === "claim" ? "본사청구 " : ""}
                        {r.who}
                        <span className="ml-1 text-slate-400">{r.kind === "reserve" ? "예약 잔금" : r.kind === "claim" ? "청구" : "외상"}</span>
                      </span>
                      <span className="tabular shrink-0 font-semibold">{won(r.remain)}원</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            {deadline.active && (deadline.missing.length > 0 || deadline.needUpload) && (
              <li className="py-1 text-sm">
                <div className="flex items-baseline gap-2">
                  <Mark warn />
                  <span className="font-medium">{Number(deadline.prevYm.slice(5, 7))}월 계산서</span>
                  <span className="tabular text-slate-500">
                    {deadline.missing.length > 0 ? `${deadline.missing.length}곳 계산서 짝 없음 — 끊을지 확인` : "확인 필요"}
                  </span>
                  <span className="ml-auto text-[11px] text-slate-400">10일까지</span>
                </div>
                {deadline.needUpload && (
                  <p className="mt-0.5 pl-6 text-xs text-amber-700">
                    이 달 홈택스 매출 파일을 아직 안 올렸습니다 — 끊었어도 앱은 모릅니다.{" "}
                    <Link href="/finance/upload" className="underline">올리기 →</Link>
                  </p>
                )}
                {deadline.missing.length > 0 && (
                  <ul className="mt-1 pl-6 text-xs text-slate-600">
                    {deadline.missing.map((r) => (
                      <li key={r.supplier} className="flex flex-wrap items-baseline gap-x-2 py-0.5">
                        <span className="min-w-0 truncate">{r.supplier}</span>
                        <span className="tabular font-semibold">{won(r.sold)}원</span>
                        <span className="text-slate-400">{r.count}건</span>
                        <InvoiceSkipButton supplier={r.supplier} ym={deadline.prevYm} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </section>

        {/* ── ② 이번 주 정리 (폰에서는 숨김 — PC 에서 하는 일) ── */}
        <section className={`${box} hidden lg:block`}>
          <h2 className="flex items-baseline justify-between font-bold">
            {W.weekly}
            <span className="tabular text-sm font-normal text-slate-400">
              {weekly.done}/{weekly.total} 끝
              <span className="ml-2 text-slate-300">·</span>
              <span className="ml-2">
                {W.lastDone} {lastDone ? `${Number(lastDone.slice(5, 7))}/${Number(lastDone.slice(8, 10))}` : "아직 없음"}
              </span>
            </span>
          </h2>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${weekly.total ? Math.round((weekly.done / weekly.total) * 100) : 0}%` }} />
          </div>
          <ul className="mt-1 divide-y divide-slate-100">
            {weekly.steps.map((s) => (
              <li key={s.key} className={row}>
                <Mark warn={s.warn} idle={s.idle} />
                <span className="min-w-0">
                  <span className="text-slate-400">{s.no}</span> <span className="font-medium">{s.title}</span>
                  <span className={`tabular ml-1.5 ${s.warn ? "text-amber-800" : "text-slate-500"}`}>{s.status}</span>
                </span>
                {/* ⭐ 3단계(2026-09-12): 기존 화면 대신 한 줄 흐름의 그 단계로 — 결정 11 */}
                {s.warn ? (
                  <Link href={`/finance/weekly?step=${s.no}&ym=${ym}`} className={goBtn}>
                    하기 →
                  </Link>
                ) : (
                  <Link href={`/finance/weekly?step=${s.no}&ym=${ym}`} className="ml-auto shrink-0 text-xs text-slate-400 underline underline-offset-2">
                    보기
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Link href={`/finance/weekly?ym=${ym}`} className="mt-2 inline-block text-xs font-medium text-brand-700 underline underline-offset-2">
            한 줄로 정리하기 →
          </Link>
        </section>

        {/* ── ③ 이번 달 돈 — 숫자만, 근거는 장부 ── */}
        <section className={box}>
          <h2 className="flex items-baseline justify-between font-bold">
            {m}월 돈
            <span className="flex gap-2 text-xs font-normal text-slate-500">
              <Link href={`/finance/ledger?ym=${ym}`} className="underline underline-offset-2">
                장부 →
              </Link>
              <Link href="/finance/activity" className="underline underline-offset-2">
                {W.activity} →
              </Link>
            </span>
          </h2>
          {delta && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              <Link href={`/finance/activity?ym=${delta.ym}`} className="underline underline-offset-2">
                ⚠️ {Number(delta.ym.slice(5, 7))}월 마감 뒤 고친 것 {delta.n}건 · {W.profit} {won(delta.closedProfit)} → {won(delta.nowProfit)}원
              </Link>
            </div>
          )}
          <ul className="tabular mt-1 divide-y divide-slate-100 text-sm">
            <li className="flex justify-between py-1">
              <Link href={`/finance/ledger?ym=${ym}#earned`} className="text-slate-600">{W.sales}</Link>
              <strong className="text-emerald-700">{won(pl.earnedTotal)}원</strong>
            </li>
            <li className="flex justify-between py-1">
              <Link href={`/finance/ledger?ym=${ym}#spent`} className="text-slate-600">{W.cost}</Link>
              <strong className="text-red-600">{won(pl.spent)}원</strong>
            </li>
            <li className="flex justify-between py-1 text-base">
              <Link href={`/finance/ledger?ym=${ym}#profit`} className="font-semibold">{W.profit}</Link>
              <strong className={pl.profit >= 0 ? "text-emerald-700" : "text-red-600"}>{won(pl.profit)}원</strong>
            </li>
            <li className="flex justify-between py-1 pt-2">
              <Link href="/receivables" className="text-slate-600">{W.receivable}</Link>
              <span>
                <strong className="text-amber-800">{won(recv.remain)}원</strong>
                {recv.reserveCount > 0 && <span className="ml-1 text-xs text-slate-400">(📌예약 {manwon(recv.reserveRemain)})</span>}
              </span>
            </li>
            <li className="flex justify-between py-1">
              <Link href={`/finance/payables?ym=${ym}`} className="text-slate-600">{W.payable}</Link>
              <strong className="text-red-700">{won(payable)}원</strong>
            </li>
          </ul>
          {pl.feeEstimated > 0 && <p className="mt-1 text-[11px] text-slate-400">카드 수수료는 정산 자료 전이라 추정값입니다</p>}
          <p className="mt-1 text-[11px] text-slate-400">「{W.receivable}·{W.payable}」은 달과 상관없는 지금 기준입니다. 숫자를 누르면 근거가 나옵니다.</p>
        </section>
      </div>

      {/* 자동 검사 — A1(안 들어온 이체)은 위 「오늘」이 대신하므로 배너는 A2~A4 만 */}
      <div className="hidden lg:block">
        <AuditBanner audit={audit} hideCodes={["A1"]} />
      </div>

      {/* 상대별 할 일 — 접어 둔다. 3단계(이번 주 정리 흐름)가 흡수하면 뺀다 */}
      {inbox && inbox.groups.length > 0 && (
        <details className="mt-3 hidden lg:block">
          <summary className="cursor-pointer text-sm text-slate-500">
            상대별로 보기 ({inbox.groups.length}곳) — 자세히
          </summary>
          <InboxSection inbox={inbox} ym={ym} />
        </details>
      )}
    </FinShell>
  );
}
