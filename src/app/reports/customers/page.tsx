import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { kstToday, pickYm, ymAdd, DATA_START } from "@/lib/ym";
import { customerReportData } from "@/lib/report-customers";
import {
  GAP_BUCKETS,
  LAPSE_BUCKETS,
  SPEND_BUCKETS,
  VISIT_BUCKETS,
  WHO_LABEL,
  daysToMonthsText,
  pctOf,
  pickWho,
  whoNoun,
  whoUnit,
  type Who,
} from "@/lib/report-cv-pure";
import { ColumnChart, StackedBar, fmtWon, type Bar } from "../charts";
import { BarList, ReportTabs, Section, Stat, WhoToggle, fmtShort } from "../ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 손님 리포트 — 사장님 전용 (2026-09-14 신설)
 *
 *   "고객과 차량 관련 리포트가 필요" — 목적: 손님 구성 파악 (참고용).
 *   확정: 숫자·그래프만(명단 없음) · 이번 달 + 최근 12개월/누적 섞기 ·
 *         [개인·거래처·전체] 단추 · 손님당 지표는 최근 12개월 · 재방문 간격은 구간 막대.
 *
 * 각도: ①핵심 숫자 ②새 손님·다시 온 손님 12개월 ③다시 오기까지 걸린 기간
 *       ④손님당 쓰는 돈 ⑤방문 횟수 ⑥오랫동안 안 온 손님.
 * 자료·판정은 lib/report-customers.ts — 화면에 SQL 을 두지 않는다.
 */
export default async function CustomerReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("reports"))) redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const who = pickWho(sp.who);
  const thisYm = kstToday().slice(0, 7);
  const isCurrent = ym === thisYm;
  const [yy, mm] = ym.split("-").map(Number);

  const r = await customerReportData(ym, who);

  const href = (nextYm: string, nextWho: Who) =>
    `/reports/customers?ym=${nextYm}${nextWho === "person" ? "" : `&who=${nextWho}`}`;
  const noun = whoNoun(who);
  const unit = whoUnit(who);

  const cur = r.months[r.months.length - 1];
  const y = r.year;
  const repeaters = y.buyers - (y.visitCounts[0] ?? 0);
  const avgSpend = y.buyers > 0 ? Math.round(y.amount / y.buyers) : 0;
  const avgVisits = y.buyers > 0 ? y.visits / y.buyers : 0;

  const monthBars = (pick: (m: (typeof r.months)[number]) => number, other: (m: (typeof r.months)[number]) => string): Bar[] =>
    r.months.map((m, i) => {
      const [ky, km] = m.ym.split("-").map(Number);
      return {
        label: km === 1 || i === 0 ? `${String(ky).slice(2)}.${km}` : `${km}월`,
        value: pick(m),
        hint: `${ky}년 ${km}월 · ${pick(m)}${unit} · ${other(m)}`,
        hot: m.ym === ym,
      };
    });
  const newBars = monthBars((m) => m.newN, (m) => `다시 온 ${noun} ${m.retN}${unit}`);
  const retBars = monthBars((m) => m.retN, (m) => `새 ${noun} ${m.newN}${unit}`);

  const bucketBars = (labels: { label: string }[], vals: number[], total: number, u: string): Bar[] =>
    labels.map((b, i) => ({
      label: b.label,
      value: vals[i] ?? 0,
      hint: `${b.label} · ${vals[i] ?? 0}${u} (${pctOf(vals[i] ?? 0, total)}%)`,
    }));

  const curTotalAmt = cur.newAmt + cur.retAmt;
  const earlyData = r.winStart < "2026-01-01";

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">손님 리포트</h1>
        <ReportTabs active="customers" />
      </header>

      <div className="mt-3">
        <WhoToggle who={who} href={(w) => href(ym, w)} />
      </div>

      {/* ---- ① 헤드라인 ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            최근 12개월 다녀간 {noun}
            <span className="ml-1 text-slate-400">
              · {yy}년 {mm}월{isCurrent ? " 오늘" : " 말"} 기준
            </span>
          </span>
          <span className="flex items-center gap-1 text-sm">
            {ym > DATA_START ? (
              <Link href={href(ymAdd(ym, -1), who)} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
                ←
              </Link>
            ) : (
              <span className="px-2 py-1 text-slate-200">←</span>
            )}
            {isCurrent ? (
              <span className="px-2 py-1 text-slate-200">→</span>
            ) : (
              <Link href={href(ymAdd(ym, 1), who)} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
                →
              </Link>
            )}
          </span>
        </div>
        <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">
          {y.buyers.toLocaleString("ko-KR")}
          {unit}
        </div>
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label={`${mm}월 ${noun}`}
            value={`${cur.newN + cur.retN}${unit}`}
            sub={`새 ${cur.newN} · 다시 온 ${cur.retN}`}
          />
          <Stat label="다시 온 비율" value={`${pctOf(repeaters, y.buyers)}%`} sub={`12개월에 2번 이상 · ${repeaters}${unit}`} />
          <Stat label={`${noun} 1${unit}당 쓴 돈`} value={fmtWon(avgSpend)} sub={`12개월 · 중간값 ${fmtShort(y.medianSpend)}원`} />
          <Stat label="1년에 오는 횟수" value={`${avgVisits.toFixed(1)}번`} sub="같은 날 여러 건은 1번" />
          <Stat
            label="6개월 넘게 안 온"
            value={`${r.lapse.over180.toLocaleString("ko-KR")}${unit}`}
            sub={`지금까지 온 ${r.lapse.everBuyers.toLocaleString("ko-KR")}${unit} 중 ${pctOf(r.lapse.over180, r.lapse.everBuyers)}%`}
          />
        </div>
      </section>

      {y.buyers === 0 && (
        <p className="mt-4 rounded-card border border-slate-200 bg-white p-4 text-center text-slate-500">
          최근 12개월에 {WHO_LABEL[who]} 판매가 없습니다
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- ② 새 · 다시 온 ---- */}
        <Section
          title={`새 ${noun} · 다시 온 ${noun}`}
          sub={`달마다 몇 ${unit}인지 · 「새」는 그 달에 처음 산 ${noun}${
            earlyData ? " · 기록이 2025년 1월부터라 2025년은 새 손님이 많게 잡힙니다" : ""
          }`}
        >
          <p className="text-xs font-medium text-slate-400">새 {noun}</p>
          <ColumnChart data={newBars} height={140} unit={unit} />
          <p className="mt-3 text-xs font-medium text-slate-400">다시 온 {noun}</p>
          <ColumnChart data={retBars} height={140} unit={unit} color="#2a78d6" hotColor="#1c5aa6" />
          {curTotalAmt > 0 && (
            <>
              <p className="mt-4 text-xs font-medium text-slate-400">{mm}월 매출 중</p>
              <div className="mt-1.5">
                <StackedBar
                  clipId="cust-newret"
                  parts={[
                    { label: `새 ${noun}`, value: cur.newAmt, color: "#009944" },
                    { label: `다시 온 ${noun}`, value: cur.retAmt, color: "#2a78d6" },
                  ]}
                />
              </div>
              <ul className="mt-2 space-y-1.5">
                {[
                  { label: `새 ${noun}`, amt: cur.newAmt, color: "#009944" },
                  { label: `다시 온 ${noun}`, amt: cur.retAmt, color: "#2a78d6" },
                ].map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                    <span className="tabular-nums font-medium">
                      {fmtWon(s.amt)}
                      <span className="ml-2 text-slate-400">{pctOf(s.amt, curTotalAmt)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* ---- ③ 다시 오기까지 ---- */}
        <Section
          title="다시 오기까지 걸린 기간"
          sub={`같은 ${noun}의 방문과 다음 방문 사이 · 2025년 1월부터 ${r.gaps.n.toLocaleString("ko-KR")}번의 재방문`}
        >
          {r.gaps.n > 0 ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-sm text-slate-500">
                  보통 <strong className="tabular text-lg text-slate-900">{daysToMonthsText(r.gaps.medianDays)}</strong> 뒤
                </span>
                <span className="text-xs text-slate-400">가운데값 · 평균 {daysToMonthsText(r.gaps.avgDays)}</span>
              </div>
              <div className="mt-2">
                <ColumnChart data={bucketBars(GAP_BUCKETS, r.gaps.buckets, r.gaps.n, "번")} height={170} unit="번" />
              </div>
              <p className="mt-2 text-xs text-slate-400">「1개월 안」에는 펑크·재점검 같은 후속 방문이 섞여 있습니다.</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">아직 다시 온 기록이 없습니다</p>
          )}
        </Section>

        {/* ---- ④ 손님당 쓰는 돈 ---- */}
        <Section title={`${noun}당 쓰는 돈`} sub={`최근 12개월 동안 한 ${noun}${who === "biz" ? "가" : "이"} 쓴 합계`}>
          {y.buyers > 0 ? (
            <>
              <div className="tabular grid grid-cols-3 gap-x-4">
                <Stat label="평균" value={fmtShort(avgSpend) + "원"} />
                <Stat label="가운데값" value={fmtShort(y.medianSpend) + "원"} />
                <Stat
                  label={`상위 20% ${noun}`}
                  value={`매출의 ${pctOf(y.top20Amount, y.amount)}%`}
                  sub={`${Math.ceil(y.buyers * 0.2)}${unit}`}
                />
              </div>
              <div className="mt-3">
                <ColumnChart data={bucketBars(SPEND_BUCKETS, y.spend, y.buyers, unit)} height={170} unit={unit} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>

        {/* ---- ⑤ 방문 횟수 ---- */}
        <Section title="1년에 몇 번 오나" sub={`최근 12개월 · 같은 날 여러 건은 1번으로 셉니다`}>
          {y.buyers > 0 ? (
            <BarList
              rows={VISIT_BUCKETS.map((b, i) => ({
                key: b.label,
                label: b.label,
                note: `${pctOf(y.visitCounts[i] ?? 0, y.buyers)}% · `,
                value: `${(y.visitCounts[i] ?? 0).toLocaleString("ko-KR")}${unit}`,
                weight: y.visitCounts[i] ?? 0,
              }))}
            />
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>

        {/* ---- ⑥ 오랫동안 안 온 ---- */}
        <Section
          title={`오랫동안 안 온 ${noun}`}
          sub={`마지막으로 온 뒤 지난 기간 · ${yy}년 ${mm}월${isCurrent ? " 오늘" : " 말"} 기준 · 기록이 2025년 1월부터라 그 전에 온 손님은 모릅니다`}
        >
          {r.lapse.everBuyers > 0 ? (
            <BarList
              color="#898781"
              rows={LAPSE_BUCKETS.map((b, i) => ({
                key: b.label,
                label: b.label,
                note: `${pctOf(r.lapse.buckets[i] ?? 0, r.lapse.everBuyers)}% · `,
                value: `${(r.lapse.buckets[i] ?? 0).toLocaleString("ko-KR")}${unit}`,
                weight: r.lapse.buckets[i] ?? 0,
              }))}
            />
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        정비한 날(work_date) 기준 · 성사된 판매만 · {WHO_LABEL[who]} 판매만 집계
        {who !== "biz" &&
          ` · 「고객」「관광객」 같은 자리표시 이름과 손님 없는 판매(최근 12개월 ${r.excludedSales.toLocaleString("ko-KR")}건)는 한 사람으로 셀 수 없어 뺐습니다`}
        {who === "biz" && " · 거래처는 이름 하나를 한 곳으로 셉니다"} · 2026년 7월 이전 판매는 MARS 에서 날짜·금액만 옮겨 왔습니다
      </p>
    </main>
  );
}
