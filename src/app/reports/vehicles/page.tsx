import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { kstToday, pickYm, ymAdd, DATA_START } from "@/lib/ym";
import { vehicleReportData, type NamedCount } from "@/lib/report-vehicles";
import {
  AGE_BUCKETS,
  BODY_ORDER,
  FUEL_ORDER,
  KM_BUCKETS,
  WHO_LABEL,
  pctOf,
  pickWho,
  type Who,
} from "@/lib/report-cv-pure";
import { ColumnChart, StackedBar, type Bar, type Segment } from "../charts";
import { BarList, ReportTabs, Section, Stat, WhoToggle } from "../ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 차량 리포트 — 사장님 전용 (2026-09-14 신설)
 *
 *   "고객과 차량 관련 리포트가 필요" — 목적: 차종 흐름을 재고·마케팅에 참고.
 *   확정: 숫자·그래프만 · [개인·거래처·전체] 단추 · 제조사·차종 순위 ·
 *         타이어 규격·인치 · 연식·주행거리·연료.
 *
 * 각도: ①핵심 숫자 ②제조사(국산/수입) ③차종 톱15 ④인치·규격(2026-08~)
 *       ⑤차령 ⑥주행거리 ⑦연료·차체(기록 있는 차 기준).
 * 자료·판정은 lib/report-vehicles.ts — 화면에 SQL 을 두지 않는다.
 */

/** 구성비 색 — 매출 리포트 결제수단과 같은 검증 팔레트 + 보조 2색 */
const MIX_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#8657c9", "#d6a02a", "#898781"];

export default async function VehicleReportPage({
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

  const r = await vehicleReportData(ym, who);
  const s = r.summary;

  const href = (nextYm: string, nextWho: Who) =>
    `/reports/vehicles?ym=${nextYm}${nextWho === "person" ? "" : `&who=${nextWho}`}`;

  const makerKnown = s.domestic + s.imported;
  const rankRows = (rows: NamedCount[], total: number) =>
    rows.map((m) => ({
      key: m.name,
      label: m.name,
      note: `${pctOf(m.n, total)}% · `,
      value: `${m.n.toLocaleString("ko-KR")}대`,
      weight: m.n,
    }));

  const bucketBars = (labels: { label: string }[], vals: number[], total: number): Bar[] =>
    labels.map((b, i) => ({
      label: b.label,
      value: vals[i] ?? 0,
      hint: `${b.label} · ${vals[i] ?? 0}대 (${pctOf(vals[i] ?? 0, total)}%)`,
    }));

  const rimTotal = r.rims.reduce((a, b) => a + b.qty, 0);
  const rimBars: Bar[] = r.rims.map((x) => ({
    label: `${x.rim}″`,
    value: x.qty,
    hint: `${x.rim}인치 · ${x.qty}본 (${pctOf(x.qty, rimTotal)}%)`,
  }));
  const tireFromLabel = r.tireFrom ? `${Number(r.tireFrom.slice(0, 4))}년 ${Number(r.tireFrom.slice(5, 7))}월` : "";

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">차량 리포트</h1>
        <ReportTabs active="vehicles" />
      </header>

      <div className="mt-3">
        <WhoToggle who={who} href={(w) => href(ym, w)} />
      </div>

      {/* ---- ① 헤드라인 ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            최근 12개월 다녀간 차
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
          {s.vehicles.toLocaleString("ko-KR")}대
        </div>
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Stat label={`${mm}월 다녀간 차`} value={`${s.thisMonth}대`} sub={`그중 처음 온 차 ${s.firstThisMonth}대`} />
          <Stat
            label="수입차 비율"
            value={`${pctOf(s.imported, makerKnown)}%`}
            sub={`국산 ${s.domestic.toLocaleString("ko-KR")} · 수입 ${s.imported.toLocaleString("ko-KR")}대`}
          />
          <Stat
            label="평균 차령"
            value={s.avgAge === null ? "—" : `${s.avgAge.toFixed(1)}년`}
            sub={`연식 기록 ${pctOf(s.withYear, s.vehicles)}%`}
          />
          <Stat
            label="평균 주행거리"
            value={s.avgKm === null ? "—" : `${(s.avgKm / 10000).toFixed(1)}만km`}
            sub={`기록 ${pctOf(s.withKm, s.vehicles)}% · 마지막 기록값`}
          />
        </div>
      </section>

      {s.vehicles === 0 && (
        <p className="mt-4 rounded-card border border-slate-200 bg-white p-4 text-center text-slate-500">
          최근 12개월에 {WHO_LABEL[who]} 판매로 다녀간 차가 없습니다
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- ② 제조사 ---- */}
        <Section title="제조사" sub={`많이 오는 순 · 톱10${r.unknownMaker ? ` · 제조사 모르는 ${r.unknownMaker}대 제외` : ""}`}>
          {r.makers.length ? (
            <>
              {makerKnown > 0 && (
                <>
                  <StackedBar
                    unit="대"
                    clipId="veh-import"
                    parts={[
                      { label: "국산", value: s.domestic, color: "#009944" },
                      { label: "수입", value: s.imported, color: "#8657c9" },
                    ]}
                  />
                  <p className="tabular mt-1.5 mb-3 flex justify-between text-xs text-slate-500">
                    <span>국산 {pctOf(s.domestic, makerKnown)}%</span>
                    <span>수입 {pctOf(s.imported, makerKnown)}%</span>
                  </p>
                </>
              )}
              <BarList rows={rankRows(r.makers, s.vehicles)} />
            </>
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>

        {/* ---- ③ 차종 ---- */}
        <Section
          title="차종 톱15"
          sub={`「쏘나타(DN8)」처럼 괄호로 적은 세대는 한 차종으로 묶어 셉니다${r.unknownModel ? ` · 차종 모르는 ${r.unknownModel}대 제외` : ""}`}
        >
          {r.models.length ? <BarList rows={rankRows(r.models, s.vehicles)} /> : <p className="text-sm text-slate-400">아직 없습니다</p>}
        </Section>

        {/* ---- ④ 타이어 인치·규격 ---- */}
        <Section
          wide
          title="판 타이어 — 인치 · 규격"
          sub={
            r.tireFrom
              ? `${tireFromLabel}부터 ${yy}년 ${mm}월까지 판 본수 · 그 전 판매는 품목 기록이 없습니다`
              : "2026년 8월부터 집계합니다 — 그 전 판매는 MARS 에서 금액만 옮겨 와 규격을 알 수 없습니다"
          }
        >
          {r.tireFrom && rimTotal > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-400">인치별 · 모두 {rimTotal.toLocaleString("ko-KR")}본</p>
                <ColumnChart data={rimBars} height={170} unit="본" />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-400">많이 판 규격 톱10</p>
                <BarList
                  rows={r.specs.map((x) => ({
                    key: x.name,
                    label: x.name,
                    note: `${pctOf(x.n, rimTotal)}% · `,
                    value: `${x.n}본`,
                    weight: x.n,
                  }))}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">{r.tireFrom ? "이 기간에 판 타이어가 없습니다" : "이 달은 품목 기록이 없는 기간입니다"}</p>
          )}
        </Section>

        {/* ---- ⑤ 차령 ---- */}
        <Section title="차령 (몇 년 된 차인가)" sub={`${yy}년 기준 · 연식 모르는 ${s.vehicles - s.withYear}대 제외`}>
          <ColumnChart data={bucketBars(AGE_BUCKETS, s.ages, s.withYear)} height={170} unit="대" />
        </Section>

        {/* ---- ⑥ 주행거리 ---- */}
        <Section title="주행거리" sub={`차량 카드의 마지막 기록 · 모르는 ${s.vehicles - s.withKm}대 제외`}>
          <ColumnChart data={bucketBars(KM_BUCKETS, s.kms, s.withKm)} height={170} unit="대" />
        </Section>

        {/* ---- ⑦ 연료 · 차체 ---- */}
        <MixSection
          title="연료"
          rows={r.fuels}
          order={FUEL_ORDER}
          total={s.vehicles}
          clipId="veh-fuel"
        />
        <MixSection
          title="차체"
          rows={r.bodies}
          order={BODY_ORDER}
          total={s.vehicles}
          clipId="veh-body"
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        다녀간 차 = 최근 12개월 안에 성사된 {WHO_LABEL[who]} 판매가 있는 차량 · 정비한 날(work_date) 기준 · 제조사·차종은
        MARS 원문 표기를 별칭표로 맞춰 셉니다 · 연료·차체는 기록이 있는 차만 셉니다
      </p>
    </main>
  );
}

/** 구성비 한 줄 + 범례 — 기록 있는 차가 전체의 몇 %인지 같이 적는다 (숫자를 꾸미지 않는다) */
function MixSection({
  title,
  rows,
  order,
  total,
  clipId,
}: {
  title: string;
  rows: NamedCount[];
  order: string[];
  total: number;
  clipId: string;
}) {
  const sorted = [...rows].sort((a, b) => {
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const known = sorted.reduce((a, b) => a + b.n, 0);
  const parts: Segment[] = sorted.map((x, i) => ({ label: x.name, value: x.n, color: MIX_COLORS[i % MIX_COLORS.length] }));

  return (
    <Section title={title} sub={`기록 있는 ${known.toLocaleString("ko-KR")}대 기준 · 다녀간 차의 ${pctOf(known, total)}%`}>
      {known > 0 ? (
        <>
          <StackedBar parts={parts} clipId={clipId} unit="대" />
          <ul className="mt-3 space-y-1.5">
            {parts.map((p) => (
              <li key={p.label} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </span>
                <span className="tabular-nums font-medium">
                  {p.value.toLocaleString("ko-KR")}대<span className="ml-2 text-slate-400">{pctOf(p.value, known)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-slate-400">기록이 없습니다</p>
      )}
    </Section>
  );
}
