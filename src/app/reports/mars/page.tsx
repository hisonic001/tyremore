import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { canViewMarsReport, getMarsQuarterTarget } from "@/lib/mars-eval";
import { TargetForm } from "./target-form";

export const dynamic = "force-dynamic";

/**
 * ⭐ MARS 입력 평가 리포트 (사장님 요청 2026-08-10)
 *
 * 본사(미쉐린)가 매장을 평가하는 표 — 사진 근거 (통합자동화 폴더 2026-08-10):
 *   Ⅰ 타이어 (MARS 데이터 입력) 45점
 *     1. 미쉐린 그룹 소매 판매 비중 = 분기 타겟 대비 소매 MARS 등록 비율 → 30점
 *     2. 미쉐린외 소매 판매 수량 = 타브랜드 MARS 입력 수량 → 15점
 *   Ⅱ 비타이어 20점
 *     1. 경정비 서비스 가용여부 (엔진오일·브레이크패드·배터리) → 10점
 *     2. 비타이어·서비스 매출액 SOA(%) — MARS 등록 기준 → 10점
 *
 * 즉 **MARS 에 안 올리면 판 것도 점수가 안 된다** — 이 화면이 그 이유를 보여준다.
 * 정비사 계정도 계정 관리에서 열람을 켜면 볼 수 있다 (매출 금액은 사장님에게만 보인다).
 *
 * 🔴 이관분 한계: MARS 백필 판매(「MARS 정비 이관 (품목 내역 없음)」)는 품목 구분이
 *    없어 여기 수량·SOA 에 못 들어간다. 앱으로 등록한 판매부터 정확히 집계된다 —
 *    본사 화면의 공식 숫자와 다를 수 있으니 참고용 추적 지표로 본다.
 */

const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
const BACKFILL_DESC = "MARS 정비 이관 (품목 내역 없음)";

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/** 점수표: 문턱 이상이면 그 점수 (내림차순 문턱) */
function score(value: number, steps: [number, number][]): number {
  for (const [t, p] of steps) if (value >= t) return p;
  return 0;
}

const STEPS_MI: [number, number][] = [[90, 30], [85, 25], [80, 20], [75, 15], [70, 10], [65, 5]];
const STEPS_OTHER: [number, number][] = [[300, 15], [250, 14], [200, 13], [150, 12], [100, 11]];
const STEPS_SOA: [number, number][] = [[25, 10], [20, 8], [15, 6], [10, 4], [5, 2]];

export default async function MarsEvalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await canViewMarsReport())) redirect("/settings");
  const isOwner = session.role === "owner";

  // ---- 분기 정하기 (KST) ----
  const today = kstToday();
  const curYear = Number(today.slice(0, 4));
  const curQ = Math.ceil(Number(today.slice(5, 7)) / 3);
  const sp = await searchParams;
  let year = curYear;
  let quarter = curQ;
  if (typeof sp.q === "string" && /^\d{4}-[1-4]$/.test(sp.q)) {
    const [y, qq] = sp.q.split("-").map(Number);
    if (y * 10 + qq <= curYear * 10 + curQ) {
      year = y;
      quarter = qq;
    }
  }
  const isCurrent = year === curYear && quarter === curQ;
  const startMonth = (quarter - 1) * 3 + 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endYear = quarter === 4 ? year + 1 : year;
  const endMonth = quarter === 4 ? 1 : startMonth + 3;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  const prevQ = quarter === 1 ? `${year - 1}-4` : `${year}-${quarter - 1}`;
  const nextQ = quarter === 4 ? `${year + 1}-1` : `${year}-${quarter + 1}`;

  const [tireRows, soaRows, backfillRows, target] = await Promise.all([
    // ① 타이어 본수 — 미쉐린그룹/타브랜드 × MARS 등록/미등록 (해당없음 = 거래처·무상, 소매 아님 → 제외)
    db.execute<{ grp: string; registered: boolean; qty: number }>(sql`
      -- 미쉐린 그룹 = 미쉐린(MI) + BF굿리치(BFG)
      SELECT CASE WHEN p.brand_code IN ('MI', 'BFG') THEN 'mi' ELSE 'other' END grp,
             (q.mars_status = '전송완료') registered,
             SUM(qi.qty)::int qty
      FROM quote_item qi
      JOIN quote q ON q.id = qi.quote_id
      JOIN product p ON p.id = qi.product_id AND p.item_type = 'tire'
      WHERE q.status = '성사'
        AND q.mars_status IN ('전송완료', '미전송', '보류', '수동처리')
        AND ${D} >= ${start}::date AND ${D} < ${end}::date
      GROUP BY 1, 2
    `),
    // ② SOA — MARS 등록된 판매의 타이어/비타이어 매출 (품목 내역이 있는 것만)
    db.execute<{ tire_amt: string; total_amt: string; n: number }>(sql`
      SELECT COALESCE(SUM(CASE WHEN p.item_type = 'tire' THEN qi.final_price * qi.qty ELSE 0 END), 0)::bigint tire_amt,
             COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint total_amt,
             count(DISTINCT q.id)::int n
      FROM quote_item qi
      JOIN quote q ON q.id = qi.quote_id
      LEFT JOIN product p ON p.id = qi.product_id
      WHERE q.status = '성사' AND q.mars_status = '전송완료'
        AND qi.description <> ${BACKFILL_DESC}
        AND ${D} >= ${start}::date AND ${D} < ${end}::date
    `),
    // ③ 이관분 — 품목 내역이 없어 집계에서 빠지는 건수 (주석에 정직하게 적는다)
    db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT q.id)::int n
      FROM quote_item qi
      JOIN quote q ON q.id = qi.quote_id
      WHERE q.status = '성사' AND qi.description = ${BACKFILL_DESC}
        AND ${D} >= ${start}::date AND ${D} < ${end}::date
    `),
    getMarsQuarterTarget(year, quarter),
  ]);

  const pick = (grp: string, registered: boolean) =>
    tireRows.find((r) => r.grp === grp && r.registered === registered)?.qty ?? 0;
  const miReg = pick("mi", true);
  const miPend = pick("mi", false);
  const otherReg = pick("other", true);
  const otherPend = pick("other", false);

  // Ⅰ-1 미쉐린 등록 비율 — 타겟이 있어야 % 가 나온다
  const miPct = target ? Math.round((miReg / target) * 100) : null;
  const miPctPot = target ? Math.round(((miReg + miPend) / target) * 100) : null;
  const s1 = miPct === null ? null : score(miPct, STEPS_MI);
  const s1Pot = miPctPot === null ? null : score(miPctPot, STEPS_MI);

  // Ⅰ-2 타브랜드 등록 수량
  const s2 = score(otherReg, STEPS_OTHER);
  const s2Pot = score(otherReg + otherPend, STEPS_OTHER);

  // Ⅱ-1 경정비 3대 항목 — 엔진오일·브레이크패드·배터리 모두 취급 중 (매장 사실)
  const s3 = 10;

  // Ⅱ-2 서비스 SOA
  const soa = soaRows[0];
  const totalAmt = Number(soa?.total_amt ?? 0);
  const tireAmt = Number(soa?.tire_amt ?? 0);
  const nonTireAmt = totalAmt - tireAmt;
  const soaPct = totalAmt > 0 ? Math.round((nonTireAmt / totalAmt) * 100) : null;
  const s4 = soaPct === null ? null : score(soaPct, STEPS_SOA);

  const backfillN = Number(backfillRows[0]?.n ?? 0);
  const knownTotal = (s1 ?? 0) + s2 + s3 + (s4 ?? 0);
  const pendTotal = miPend + otherPend;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href={isOwner ? "/reports" : "/settings"} className="text-sm text-slate-500 underline underline-offset-4">
        ← {isOwner ? "리포트로" : "설정으로"}
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">MARS 입력 평가</h1>
        <span className="text-xs text-slate-400">본사 평가표 기준 자체 추적</span>
      </header>

      {isOwner && (
        <div className="mt-3 flex gap-1.5">
          <Link href="/reports" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
            매출
          </Link>
          <Link href="/reports/stock" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
            재고
          </Link>
          <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">MARS 평가</span>
        </div>
      )}

      {/* 분기 넘기기 */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2 py-2">
        <Link href={`/reports/mars?q=${prevQ}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-100">
          ← 이전 분기
        </Link>
        <div className="text-center">
          <div className="font-bold">
            {year}년 {quarter}분기
            <span className="ml-1.5 text-sm font-normal text-slate-500">
              ({startMonth}~{startMonth + 2}월)
            </span>
          </div>
          {isCurrent && <div className="text-xs text-amber-700">진행 중</div>}
        </div>
        {isCurrent ? (
          <span className="px-3 py-2 text-sm text-slate-300">다음 분기 →</span>
        ) : (
          <Link href={`/reports/mars?q=${nextQ}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-100">
            다음 분기 →
          </Link>
        )}
      </div>

      {/* ---- 합계 ---- */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">지금 점수 (MARS 등록분 기준)</div>
            <div className="mt-1 text-3xl font-bold">
              {knownTotal}
              <span className="text-lg font-normal text-slate-400"> / 65점</span>
            </div>
          </div>
          {pendTotal > 0 && (
            <div className="text-right text-sm">
              <div className="font-semibold text-amber-700">아직 안 올린 타이어 {pendTotal}본</div>
              <div className="text-slate-500">MARS 에 올려야 점수에 들어갑니다</div>
            </div>
          )}
        </div>
        {s1 === null && (
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ 분기 타겟이 없어 Ⅰ-1 (30점) 은 0점으로 잡혀 있습니다 — 아래에서 타겟을 넣어 주세요.
          </p>
        )}
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- Ⅰ-1 미쉐린 등록 비율 (30점) ---- */}
        <Item
          no="Ⅰ-1"
          title="미쉐린 그룹 소매 판매 비중"
          max={30}
          got={s1}
          sub="분기 타겟 수량 대비 소매 MARS 등록 비율 (미쉐린·BF굿리치)"
        >
          <BigStat
            value={miPct === null ? `${miReg}본 등록` : `${miPct}%`}
            note={
              miPct === null
                ? "타겟을 넣으면 % 와 점수가 나옵니다"
                : `등록 ${miReg}본 ÷ 타겟 ${target}본`
            }
          />
          {miPend > 0 && (
            <Pending text={`미쉐린 그룹 ${miPend}본이 아직 MARS 에 안 올라갔습니다`} extra={
              s1 !== null && s1Pot !== null && s1Pot > s1 ? ` — 올리면 ${miPctPot}% → ${s1Pot}점` : undefined
            } />
          )}
          {isOwner && <TargetForm year={year} quarter={quarter} target={target} />}
          <Scale
            rows={[["90% 이상", 30], ["85% 이상", 25], ["80% 이상", 20], ["75% 이상", 15], ["70% 이상", 10], ["65% 이상", 5], ["60% 미만", 0]]}
            hot={s1}
          />
        </Item>

        {/* ---- Ⅰ-2 타브랜드 수량 (15점) ---- */}
        <Item
          no="Ⅰ-2"
          title="미쉐린외 소매 판매 수량"
          max={15}
          got={s2}
          sub="타브랜드 타이어의 MARS 입력 수량"
        >
          <BigStat value={`${otherReg}본`} note="MARS 등록된 타브랜드 타이어" />
          {otherPend > 0 && (
            <Pending
              text={`타브랜드 ${otherPend}본이 아직 MARS 에 안 올라갔습니다`}
              extra={s2Pot > s2 ? ` — 올리면 ${otherReg + otherPend}본 → ${s2Pot}점` : undefined}
            />
          )}
          <Scale
            rows={[["300개 이상", 15], ["250개 이상", 14], ["200개 이상", 13], ["150개 이상", 12], ["100개 이상", 11], ["100개 미만", 0]]}
            hot={s2}
          />
        </Item>

        {/* ---- Ⅱ-1 경정비 가용 (10점) ---- */}
        <Item no="Ⅱ-1" title="경정비 서비스 가용여부" max={10} got={s3} sub="3대 항목 제품 보유 (재고 및 작업)">
          <div className="mt-1 flex flex-wrap gap-1.5">
            {["엔진오일", "브레이크패드", "배터리"].map((t) => (
              <span key={t} className="rounded bg-emerald-100 px-2 py-1 text-sm font-medium text-emerald-800">
                ✓ {t}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">세 항목 모두 취급 중 → 만점. 취급을 접으면 이 점수가 내려갑니다.</p>
          <Scale rows={[["3개 준비", 10], ["2개 준비", 6], ["1개 준비", 3], ["0개", 0]]} hot={s3} />
        </Item>

        {/* ---- Ⅱ-2 서비스 SOA (10점) ---- */}
        <Item
          no="Ⅱ-2"
          title="비타이어·서비스 매출 SOA"
          max={10}
          got={s4}
          sub="전체 매출 중 비타이어(부품·공임·서비스) 비율 — MARS 등록 기준"
        >
          <BigStat
            value={soaPct === null ? "집계할 판매 없음" : `${soaPct}%`}
            note={
              soaPct === null
                ? undefined
                : isOwner
                  ? `비타이어 ${Math.round(nonTireAmt / 10000).toLocaleString()}만원 ÷ 전체 ${Math.round(totalAmt / 10000).toLocaleString()}만원 (등록 ${Number(soa?.n ?? 0)}건)`
                  : `MARS 등록 ${Number(soa?.n ?? 0)}건 기준`
            }
          />
          <Scale
            rows={[["25% 이상", 10], ["20% 이상", 8], ["15% 이상", 6], ["10% 이상", 4], ["5% 이상", 2], ["5% 미만", 0]]}
            hot={s4}
          />
        </Item>
      </div>

      <div className="mt-4 space-y-1 text-xs text-slate-400">
        <p>· 성사된 판매만, 정비한 날 기준 · 「등록」 = MARS 전송완료 · 거래처 판매·무상 서비스(해당없음)는 소매 집계에서 제외</p>
        {backfillN > 0 && (
          <p>
            · 이 분기의 MARS 이관분 {backfillN}건은 품목 내역이 없어 수량·SOA 에 못 들어갑니다 — 본사 화면의 공식
            숫자와 다를 수 있습니다. 앱으로 등록한 판매부터 정확히 잡힙니다.
          </p>
        )}
        <p>· 본사 평가표(2026-08 사진 기준)가 바뀌면 이 화면의 점수표도 같이 고쳐야 합니다.</p>
      </div>
    </main>
  );
}

function Item({
  no,
  title,
  max,
  got,
  sub,
  children,
}: {
  no: string;
  title: string;
  max: number;
  got: number | null;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            <span className="mr-1.5 text-slate-400">{no}</span>
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        <span
          className={`tabular shrink-0 rounded-lg px-3 py-1.5 text-base font-bold ${
            got === null
              ? "bg-slate-100 text-slate-400"
              : got === max
                ? "bg-emerald-100 text-emerald-800"
                : got === 0
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-100 text-amber-800"
          }`}
        >
          {got === null ? "?" : got}
          <span className="text-xs font-normal opacity-70"> /{max}</span>
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BigStat({ value, note }: { value: string; note?: string }) {
  return (
    <div>
      <div className="tabular text-2xl font-bold">{value}</div>
      {note && <div className="mt-0.5 text-sm text-slate-500">{note}</div>}
    </div>
  );
}

function Pending({ text, extra }: { text: string; extra?: string }) {
  return (
    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      ⚠️ {text}
      {extra && <strong>{extra}</strong>}
      <span className="block text-xs text-amber-700">정비 내역 화면의 「MARS 자동 올리기」로 올리세요</span>
    </p>
  );
}

/** 점수표 — 지금 받는 칸을 진하게 */
function Scale({ rows, hot }: { rows: [string, number][]; hot: number | null }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-slate-400">점수표 보기</summary>
      <table className="mt-1.5 w-full text-sm">
        <tbody>
          {rows.map(([label, pts]) => {
            const isHot = hot !== null && pts === hot;
            return (
              <tr key={label} className={`border-t border-slate-100 ${isHot ? "bg-amber-50 font-semibold" : ""}`}>
                <td className="py-1 pl-1 text-slate-600">{label}</td>
                <td className="tabular py-1 pr-1 text-right">{pts}점{isHot ? " ←" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
