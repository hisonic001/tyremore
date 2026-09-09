import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { marginSql, marginBaseSql } from "@/lib/margin-def";
import { ColumnChart, StackedBar, fmtShort, fmtWon } from "./charts";
import { Section, Stat, DeltaChip } from "./ui";
import { BrandTires, type BrandTireRow } from "./brand-tires";
import type { Bar, Segment } from "./charts";

export const dynamic = "force-dynamic";

/**
 * ⭐ 매출 리포트 — 사장님 전용 (2026-08-06 → 2026-09-03 확장·디자인 리프레시)
 *
 *   "월 마감 매출 요약 화면 … 다각도에서 매장 운영에 도움이 되도록"
 *   + 2026-09-03: 개인/거래처 갈라 보기 · 브랜드별 타이어 본수 · 마진율 요약,
 *     그리고 "토스나 notion 같이 세련되고 트렌디한 ux ui" — 정보는 명확하게,
 *     시각적 군더더기는 최소로, 그래픽은 적재적소에.
 *
 * 각도: ①핵심 숫자(헤드라인+보조 줄) ②개인·거래처 ③일별 ④12개월 ⑤요일별
 *       ⑥결제수단 ⑦브랜드 본수 ⑧톱10 품목.
 * 모집단 정본 = 성사 + 정비한 날(work_date) — 화면 하단에 명시.
 * 🔴 순위 막대는 글자 뒤에 깔지 않는다 (사장님 제보 2026-08-07 — 아래 줄로).
 */

/** 실제 판 날 — 백필·수기 입력 모두 이 열로 모은다 */
const D = sql`COALESCE(work_date, (created_at AT TIME ZONE 'Asia/Seoul')::date)`;

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/** "YYYY-MM" 에 달을 더한다 */
function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function pct(cur: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round(((cur - base) / base) * 100);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("reports"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const today = kstToday();
  const thisYm = today.slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;
  const [yy, mm] = ym.split("-").map(Number);
  const isCurrent = ym === thisYm;
  const todayDay = Number(today.slice(8, 10));

  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  const winStart = `${ymAdd(ym, -12)}-01`;
  const yearStart = `${yy}-01-01`;
  const prevYm = ymAdd(ym, -1);
  const lastYearYm = ymAdd(ym, -12);
  const daysInMonth = new Date(yy, mm, 0).getDate();

  const [months, daily, pay, guests, top, prevSpanRows, split, supTop, brands, brandModels, marginRows] = await Promise.all([
    db.execute<{ ym: string; n: number; amt: string }>(sql`
      SELECT to_char(${D}, 'YYYY-MM') ym, count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
      FROM quote
      WHERE status = '성사' AND ${D} >= ${winStart}::date AND ${D} < ${nextStart}::date
      GROUP BY 1
    `),
    db.execute<{ day: number; n: number; amt: string }>(sql`
      SELECT EXTRACT(DAY FROM ${D})::int AS day, count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
      FROM quote
      WHERE status = '성사' AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
      GROUP BY 1
    `),
    db.execute<{ p: string; n: number; amt: string }>(sql`
      -- ⭐ 분할 결제는 수단별 금액으로 갈라 센다 (2026-08-10)
      SELECT p, count(DISTINCT qid)::int n, COALESCE(SUM(amt),0)::bigint amt
      FROM (
        SELECT q.id qid,
               COALESCE(qp.method, q.payment_method, '기타') p,
               COALESCE(qp.amount, q.total_amount) amt
        FROM quote q
        LEFT JOIN quote_payment qp ON qp.quote_id = q.id
        WHERE q.status = '성사'
          AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
          AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      ) t
      GROUP BY 1 ORDER BY amt DESC
    `),
    db.execute<{ new_n: number; ret_n: number }>(sql`
      WITH s AS (
        SELECT customer_id, ${D} d FROM quote
        WHERE status = '성사' AND customer_id IS NOT NULL
      ),
      f AS (SELECT customer_id, MIN(d) fd FROM s GROUP BY 1)
      SELECT
        count(DISTINCT s.customer_id) FILTER (WHERE f.fd >= ${start}::date)::int new_n,
        count(DISTINCT s.customer_id) FILTER (WHERE f.fd < ${start}::date)::int ret_n
      FROM s JOIN f USING (customer_id)
      WHERE s.d >= ${start}::date AND s.d < ${nextStart}::date
    `),
    db.execute<{ name: string; q: number; amt: string }>(sql`
      SELECT qi.description name, SUM(qi.qty)::int q, COALESCE(SUM(qi.final_price * qi.qty),0)::bigint amt
      FROM quote_item qi JOIN quote qq ON qq.id = qi.quote_id
      WHERE qq.status = '성사'
        AND NOT (qi.line_type = 'use' AND qi.final_price = 0)
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      GROUP BY 1 ORDER BY amt DESC LIMIT 10
    `),
    isCurrent
      ? db.execute<{ n: number; amt: string }>(sql`
          SELECT count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
          FROM quote
          WHERE status = '성사' AND ${D} >= ${prevYm + "-01"}::date AND ${D} < ${start}::date
            AND EXTRACT(DAY FROM ${D}) <= ${todayDay}
        `)
      : Promise.resolve([] as { n: number; amt: string }[]),
    /* ⭐ 개인 vs 거래처 (2026-09-03) — 쏘카·AJ 물량이 섞이면 가게 체질이 안 보인다 */
    db.execute<{ biz: boolean; n: number; amt: string }>(sql`
      SELECT (supplier_name IS NOT NULL) biz, count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
      FROM quote
      WHERE status = '성사' AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
      GROUP BY 1
    `),
    db.execute<{ name: string; n: number; amt: string }>(sql`
      SELECT supplier_name name, count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
      FROM quote
      WHERE status = '성사' AND supplier_name IS NOT NULL
        AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
      GROUP BY 1 ORDER BY amt DESC LIMIT 5
    `),
    /* ⭐ 브랜드별 타이어 본수 — 이번 달 + 올해 누적 (2026-09-03) */
    db.execute<{ brand: string; mq: number; yq: number }>(sql`
      SELECT COALESCE(b.name_ko, p.brand_code, '기타') brand,
             COALESCE(SUM(qi.qty) FILTER (WHERE ${sql.raw(`COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date)`)} >= ${start}::date), 0)::int mq,
             SUM(qi.qty)::int yq
      FROM quote_item qi
      JOIN quote qq ON qq.id = qi.quote_id
      LEFT JOIN product p ON p.id = qi.product_id
      LEFT JOIN brand b ON b.code = p.brand_code
      WHERE qq.status = '성사' AND qi.line_type = 'tire'
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${yearStart}::date
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 12
    `),
    /* ⭐ 브랜드→모델 드릴다운 (사장님 요청 2026-09-04) — 막대를 누르면 어떤
     *   타이어를 몇 본 팔았는지. 이번 달 팔린 모델만 (막대와 같은 모집단) */
    db.execute<{ brand: string; name: string; mq: number; yq: number }>(sql`
      SELECT COALESCE(b.name_ko, p.brand_code, '기타') brand, qi.description name,
             COALESCE(SUM(qi.qty) FILTER (WHERE ${sql.raw(`COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date)`)} >= ${start}::date), 0)::int mq,
             SUM(qi.qty)::int yq
      FROM quote_item qi
      JOIN quote qq ON qq.id = qi.quote_id
      LEFT JOIN product p ON p.id = qi.product_id
      LEFT JOIN brand b ON b.code = p.brand_code
      WHERE qq.status = '성사' AND qi.line_type = 'tire'
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${yearStart}::date
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      GROUP BY 1, 2
      HAVING COALESCE(SUM(qi.qty) FILTER (WHERE ${sql.raw(`COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date)`)} >= ${start}::date), 0) > 0
      ORDER BY 3 DESC, 4 DESC LIMIT 200
    `),
    /* ⭐ 마진율 — 정의 정본은 lib/margin-def.ts (2026-09-04 개정: 공임 매출 포함,
     *   소모품 원가 차감, 원가 모르는 물품은 제외하고 커버리지로 명시) */
    db.execute<{ ym: string; m: string; base: string; known: string; total: string }>(sql`
      SELECT to_char(COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM') ym,
             COALESCE(SUM(${marginSql}), 0)::bigint m,
             COALESCE(SUM(${marginBaseSql}), 0)::bigint base,
             COALESCE(SUM(${marginBaseSql}), 0)::bigint known,
             COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint total
      FROM quote_item qi JOIN quote qq ON qq.id = qi.quote_id
      WHERE qq.status = '성사' AND qq.quote_no LIKE 'Q%'
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${prevYm + "-01"}::date
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      GROUP BY 1
    `),
  ]);

  const byYm = new Map(months.map((m) => [m.ym, { n: m.n, amt: Number(m.amt) }]));
  const cur = byYm.get(ym) ?? { n: 0, amt: 0 };
  const prev = byYm.get(prevYm) ?? { n: 0, amt: 0 };
  const lastYear = byYm.get(lastYearYm) ?? { n: 0, amt: 0 };
  const prevSpan = prevSpanRows[0] ? { n: prevSpanRows[0].n, amt: Number(prevSpanRows[0].amt) } : null;

  // --- 12개월 추이 ---
  const trend: Bar[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = ymAdd(ym, -i);
    const v = byYm.get(k) ?? { n: 0, amt: 0 };
    const [ky, km] = k.split("-").map(Number);
    trend.push({
      label: km === 1 || i === 11 ? `${String(ky).slice(2)}.${km}` : `${km}월`,
      value: v.amt,
      hint: `${ky}년 ${km}월 · ${v.n}건 · ${fmtWon(v.amt)}`,
      hot: k === ym,
    });
  }

  // --- 일별 ---
  const byDay = new Map(daily.map((d) => [d.day, { n: d.n, amt: Number(d.amt) }]));
  const days: Bar[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const v = byDay.get(d) ?? { n: 0, amt: 0 };
    days.push({
      label: d === 1 || d % 5 === 0 ? String(d) : "",
      value: v.amt,
      hint: `${mm}월 ${d}일 · ${v.n}건 · ${fmtWon(v.amt)}`,
    });
  }

  // --- 결제수단 (색 고정 — 색약 검증 통과 팔레트, 변경 금지) ---
  const PAY_COLOR: Record<string, string> = {
    카드: "#2a78d6",
    현금: "#eb6834",
    계좌이체: "#1baf7a",
    지역화폐: "#8657c9",
  };
  const segs: Segment[] = pay.map((p) => ({
    label: p.p,
    value: Number(p.amt),
    color: PAY_COLOR[p.p] ?? "#898781",
  }));

  const g = guests[0] ?? { new_n: 0, ret_n: 0 };
  const avg = cur.n > 0 ? Math.round(cur.amt / cur.n) : 0;
  const topMax = top.length ? Number(top[0].amt) : 0;

  // --- 요일별 ---
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const lastDay = isCurrent ? todayDay : daysInMonth;
  const wk = Array.from({ length: 7 }, () => ({ amt: 0, n: 0, days: 0 }));
  for (let d = 1; d <= lastDay; d++) {
    const w = new Date(yy, mm - 1, d).getDay();
    const v = byDay.get(d) ?? { n: 0, amt: 0 };
    wk[w].amt += v.amt;
    wk[w].n += v.n;
    wk[w].days += 1;
  }
  const weekBars: Bar[] = [1, 2, 3, 4, 5, 6, 0].map((w) => ({
    label: `${WD[w]}`,
    value: wk[w].amt,
    hint: `${WD[w]}요일 · ${wk[w].n}건 · 합 ${fmtWon(wk[w].amt)}${
      wk[w].days > 0 ? ` · 하루 평균 ${fmtWon(Math.round(wk[w].amt / wk[w].days))}` : ""
    }`,
  }));

  const salesDelta = isCurrent ? pct(cur.amt, prevSpan?.amt ?? 0) : pct(cur.amt, prev.amt);
  const yearDelta = isCurrent ? null : pct(cur.amt, lastYear.amt);

  // --- 개인 vs 거래처 (2026-09-03) ---
  const person = split.find((s) => !s.biz) ?? { n: 0, amt: "0" };
  const biz = split.find((s) => s.biz) ?? { n: 0, amt: "0" };
  const personAmt = Number(person.amt);
  const bizAmt = Number(biz.amt);
  const splitSegs: Segment[] = [
    { label: "개인 손님", value: personAmt, color: "#009944" },
    { label: "거래처", value: bizAmt, color: "#7c5cd6" },
  ].filter((s) => s.value > 0);
  const supMax = supTop.length ? Number(supTop[0].amt) : 0;

  // --- 브랜드 본수 (2026-09-03) + 모델 드릴다운 (2026-09-04) ---
  const brandRows: BrandTireRow[] = brands
    .filter((b) => Number(b.mq) > 0)
    .map((b) => ({
      brand: b.brand,
      short: b.brand.replace(/타이어$/, ""),
      mq: Number(b.mq),
      yq: Number(b.yq),
      models: brandModels
        .filter((m) => m.brand === b.brand)
        .map((m) => ({ name: m.name, mq: Number(m.mq), yq: Number(m.yq) })),
    }));
  const tireMonthTotal = brands.reduce((s, b) => s + Number(b.mq), 0);
  const tireYearTotal = brands.reduce((s, b) => s + Number(b.yq), 0);

  // --- 마진율 (2026-09-03) — 원가 기록 있는 줄 기준, 커버리지 명시 ---
  const mCur = marginRows.find((r) => r.ym === ym);
  const mPrev = marginRows.find((r) => r.ym === prevYm);
  const rate = (r?: { m: string; base: string }) =>
    r && Number(r.base) > 0 ? (Number(r.m) / Number(r.base)) * 100 : null;
  const marginRate = rate(mCur);
  const marginPrevRate = rate(mPrev);
  const coverage = mCur && Number(mCur.total) > 0 ? Math.round((Number(mCur.known) / Number(mCur.total)) * 100) : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">매출 리포트</h1>
        <div className="flex gap-1">
          <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">매출</span>
          <Link href="/reports/stock" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            재고
          </Link>
          <Link href="/reports/margin" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            마진
          </Link>
          <Link href="/reports/mars" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            MARS
          </Link>
        </div>
      </header>

      {/* ---- ① 헤드라인 — 토스식 계층: 큰 숫자 하나 + 증감 칩 + 보조 줄 (2026-09-03 리프레시) ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {yy}년 {mm}월 매출{isCurrent && <span className="ml-1 text-slate-400">· 1~{todayDay}일 진행 중</span>}
          </span>
          <span className="flex items-center gap-1 text-sm">
            <Link href={`/reports?ym=${prevYm}`} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
              ←
            </Link>
            {isCurrent ? (
              <span className="px-2 py-1 text-slate-200">→</span>
            ) : (
              <Link href={`/reports?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
                →
              </Link>
            )}
          </span>
        </div>
        <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{fmtWon(cur.amt)}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {salesDelta !== null && <DeltaChip v={salesDelta} label={isCurrent ? `전월 같은 기간` : "전월"} />}
          {yearDelta !== null && <DeltaChip v={yearDelta} label={`작년 ${mm}월`} />}
        </div>
        {/* 보조 숫자 — 보더 없는 한 줄, 여백으로 구분 */}
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="판매 건수" value={`${cur.n}건`} />
          <Stat label="건당 평균" value={fmtWon(avg)} />
          <Stat label="새 손님" value={`${g.new_n}명`} />
          <Stat label="다시 온 손님" value={`${g.ret_n}명`} />
          <Stat
            label="마진율"
            value={marginRate === null ? "—" : `${marginRate.toFixed(1)}%`}
            sub={marginRate === null ? "원가 기록 없음" : `공임 포함 · 매출 ${coverage}% 기준${
              marginPrevRate !== null && marginRate !== null
                ? ` · 전월 ${marginPrevRate.toFixed(1)}%`
                : ""
            }`}
            href="/reports/margin"
          />
        </div>
      </section>

      {cur.n === 0 && (
        <p className="mt-4 rounded-card border border-slate-200 bg-white p-4 text-center text-slate-500">
          이 달에는 성사된 판매가 없습니다
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- ② 개인 vs 거래처 (2026-09-03) ---- */}
        <Section title="개인 · 거래처" sub="거래처(렌트카 등) 물량을 갈라 봐야 가게 체질이 보입니다">
          {splitSegs.length ? (
            <>
              <StackedBar parts={splitSegs} clipId="split-clip" />
              <ul className="mt-3 space-y-1.5">
                {[
                  { label: "개인 손님", amt: personAmt, n: Number(person.n), color: "#009944" },
                  { label: "거래처", amt: bizAmt, n: Number(biz.n), color: "#7c5cd6" },
                ]
                  .filter((r) => r.amt > 0)
                  .map((r) => (
                    <li key={r.label} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                        {r.label}
                        <span className="text-xs text-slate-400">{r.n}건</span>
                      </span>
                      <span className="tabular-nums font-medium">
                        {fmtWon(r.amt)}
                        <span className="ml-2 text-slate-400">{cur.amt > 0 ? Math.round((r.amt / cur.amt) * 100) : 0}%</span>
                      </span>
                    </li>
                  ))}
              </ul>
              {supTop.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-medium text-slate-400">거래처 TOP {supTop.length}</p>
                  <ol className="mt-1.5 space-y-2">
                    {supTop.map((t) => {
                      const amt = Number(t.amt);
                      const w = supMax > 0 ? Math.max(2, Math.round((amt / supMax) * 100)) : 0;
                      return (
                        <li key={t.name}>
                          <Link href={`/sales?supplier=${encodeURIComponent(t.name)}&range=month&month=${ym}`} className="block active:opacity-70">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate">{t.name}</span>
                              <span className="shrink-0 tabular-nums text-slate-600">
                                {t.n}건 · <strong className="text-slate-900">{fmtShort(amt)}</strong>
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-1.5 rounded-full bg-[#7c5cd6]" style={{ width: `${w}%` }} />
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>

        {/* ---- ③ 브랜드별 타이어 본수 (2026-09-03, 드릴다운 2026-09-04) ---- */}
        <Section title="브랜드별 타이어 본수" sub={`이번 달 ${tireMonthTotal}본 · 올해 누적 ${tireYearTotal}본 — 막대를 누르면 모델이 보입니다`}>
          {brandRows.length ? (
            <>
              <BrandTires rows={brandRows} />
              <ul className="tabular mt-2 space-y-1 text-xs text-slate-500">
                {brands
                  .filter((b) => Number(b.yq) > 0)
                  .slice(0, 6)
                  .map((b) => (
                    <li key={b.brand} className="flex justify-between">
                      <span>{b.brand}</span>
                      <span>
                        이번 달 {b.mq}본 · <strong className="text-slate-700">올해 {b.yq}본</strong>
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-400">이번 달 타이어 판매가 아직 없습니다</p>
          )}
        </Section>

        {/* ---- ④ 일별 흐름 ---- */}
        <Section title="일별 매출" sub="막대에 손을 대면 그날의 건수·금액이 뜹니다">
          <ColumnChart data={days} height={170} />
        </Section>

        {/* ---- ⑤ 12개월 추이 ---- */}
        <Section title="최근 12개월" sub="보고 있는 달이 진한 색입니다">
          <ColumnChart data={trend} height={190} />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-400">표로 보기</summary>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {[...trend].reverse().map((t) => (
                  <tr key={t.hint} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-600">{t.hint.split(" · ")[0]}</td>
                    <td className="py-1.5 text-right text-slate-500">{t.hint.split(" · ")[1]}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{fmtShort(t.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Section>

        {/* ---- ⑥ 요일별 ---- */}
        <Section
          title="요일별 매출"
          sub={`${isCurrent ? `1~${todayDay}일 기준` : `${mm}월 전체`} · 하루 평균은 막대에 손을 대면 보입니다`}
        >
          <ColumnChart data={weekBars} height={170} />
        </Section>

        {/* ---- ⑦ 결제수단 ---- */}
        <Section title="결제수단">
          {segs.length ? (
            <>
              <StackedBar parts={segs} clipId="pay-clip" />
              <ul className="mt-3 space-y-1.5">
                {segs.map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                    <span className="tabular-nums font-medium">
                      {fmtWon(s.value)}
                      <span className="ml-2 text-slate-400">
                        {cur.amt > 0 ? Math.round((s.value / cur.amt) * 100) : 0}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>

        {/* ---- ⑧ 많이 판 품목 ---- */}
        <Section wide title="많이 판 품목 톱10" sub="금액 순 · 막대는 1위 대비 크기">
          {top.length ? (
            /* 🔴 막대를 글자 뒤에 깔지 않는다 (2026-08-07 제보) — 글자 아래 얇은 줄로 */
            <ol className="space-y-2">
              {top.map((t) => {
                const amt = Number(t.amt);
                const w = topMax > 0 ? Math.max(2, Math.round((amt / topMax) * 100)) : 0;
                return (
                  <li key={t.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{t.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-600">
                        {t.q}개 · <strong className="text-slate-900">{fmtShort(amt)}</strong>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-[#009944]" style={{ width: `${w}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-slate-400">아직 없습니다</p>
          )}
        </Section>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        정비한 날(work_date) 기준 · 성사된 판매만 집계 · 마진율은 원가가 기록된 판매 줄만으로 계산합니다
      </p>
    </main>
  );
}



