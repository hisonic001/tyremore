import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { ColumnChart, StackedBar, fmtShort, fmtWon } from "./charts";
import type { Bar, Segment } from "./charts";

export const dynamic = "force-dynamic";

/**
 * ⭐ 매출 리포트 — 사장님 전용 (2026-08-06)
 *
 *   "월 마감 매출 요약 화면 … 그래픽과 그래프 등을 더해서 다각도에서
 *    매장 운영에 도움이 되도록 제대로 만들고 싶은데 (사장 어카운트만 확인 가능)"
 *
 * 각도 다섯: ①이번 달 핵심 숫자(전월·작년 대비) ②일별 흐름 ③12개월 추이
 *            ④결제수단 구성 ⑤많이 판 품목.
 * 날짜는 실제 정비한 날(work_date) 기준 — 입력한 날이 아니라 판 날로 집계한다.
 *
 * 🔴 마진 각도는 아직 없다: 판매 줄에 매입원가가 기록된 건이 0건이다
 *    (MARS 백필 3,112건에는 매입가 자체가 없다). 기록이 쌓이면 여기에 더한다.
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
  if (session.role !== "owner") redirect("/");

  const today = kstToday(); // "2026-08-06"
  const thisYm = today.slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;
  const [yy, mm] = ym.split("-").map(Number);
  const isCurrent = ym === thisYm;
  const todayDay = Number(today.slice(8, 10));

  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  const winStart = `${ymAdd(ym, -12)}-01`; // 13개월 창 — 작년 같은 달까지 포함
  const prevYm = ymAdd(ym, -1);
  const lastYearYm = ymAdd(ym, -12);
  const daysInMonth = new Date(yy, mm, 0).getDate();

  const [months, daily, pay, guests, top, prevSpanRows] = await Promise.all([
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
      -- ⭐ 분할 결제는 수단별 금액으로 갈라 센다 (2026-08-10).
      --    분할 내역이 있으면 그 줄들로, 없으면 판매 전체가 그 수단으로.
      --    (옛 「혼합」 건은 내역이 없어 혼합 그대로 남는다)
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
    // 신규 vs 재방문 — 그 손님의 생애 첫 성사 판매가 이번 달이면 신규
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
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
        AND COALESCE(qq.work_date, (qq.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      GROUP BY 1 ORDER BY amt DESC LIMIT 10
    `),
    // 진행 중인 달은 전월 「같은 기간(1~오늘 일자)」과 비교해야 공정하다
    isCurrent
      ? db.execute<{ n: number; amt: string }>(sql`
          SELECT count(*)::int n, COALESCE(SUM(total_amount),0)::bigint amt
          FROM quote
          WHERE status = '성사' AND ${D} >= ${prevYm + "-01"}::date AND ${D} < ${start}::date
            AND EXTRACT(DAY FROM ${D}) <= ${todayDay}
        `)
      : Promise.resolve([] as { n: number; amt: string }[]),
  ]);

  const byYm = new Map(months.map((m) => [m.ym, { n: m.n, amt: Number(m.amt) }]));
  const cur = byYm.get(ym) ?? { n: 0, amt: 0 };
  const prev = byYm.get(prevYm) ?? { n: 0, amt: 0 };
  const lastYear = byYm.get(lastYearYm) ?? { n: 0, amt: 0 };
  const prevSpan = prevSpanRows[0] ? { n: prevSpanRows[0].n, amt: Number(prevSpanRows[0].amt) } : null;

  // --- 12개월 추이 (보고 있는 달이 맨 오른쪽) ---
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

  // --- 일별 (빈 날은 0 으로 채워 달력 모양을 유지) ---
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

  // --- 결제수단 (색은 고정 배정 — 달이 바뀌어도 카드는 늘 파랑) ---
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

  /**
   * ⭐ 요일별 분석 (사장님 요청 2026-08-08).
   *    이미 불러온 일별 데이터에서 계산한다 — 진행 중인 달은 오늘까지만 세고,
   *    요일마다 든 날 수가 달라서 막대는 합계, 풍선에 하루 평균을 같이 적는다.
   */
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
  // 월요일부터 일요일 순으로 — 가게 한 주의 흐름대로
  const weekBars: Bar[] = [1, 2, 3, 4, 5, 6, 0].map((w) => ({
    label: `${WD[w]}`,
    value: wk[w].amt,
    hint: `${WD[w]}요일 · ${wk[w].n}건 · 합 ${fmtWon(wk[w].amt)}${
      wk[w].days > 0 ? ` · 하루 평균 ${fmtWon(Math.round(wk[w].amt / wk[w].days))}` : ""
    }`,
  }));

  const salesDelta = isCurrent ? pct(cur.amt, prevSpan?.amt ?? 0) : pct(cur.amt, prev.amt);
  const yearDelta = isCurrent ? null : pct(cur.amt, lastYear.amt);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">매출 리포트</h1>
        <span className="text-xs text-slate-400">사장님 전용</span>
      </header>

      {/* 매출 ↔ 재고 오가기 (재고 리포트: 사장님 요청 2026-08-07) */}
      <div className="mt-3 flex gap-1.5">
        <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">매출</span>
        <Link href="/reports/stock" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
          재고
        </Link>
        {/* ⭐ MARS 입력 평가 (사장님 요청 2026-08-10) */}
        <Link href="/reports/mars" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
          MARS 평가
        </Link>
      </div>

      {/* 달 넘기기 */}
      <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-2 py-2">
        <Link href={`/reports?ym=${prevYm}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-100">
          ← {Number(prevYm.slice(5))}월
        </Link>
        <div className="text-center">
          <div className="font-bold">
            {yy}년 {mm}월
          </div>
          {isCurrent && <div className="text-xs text-amber-700">1~{todayDay}일 진행 중</div>}
        </div>
        {isCurrent ? (
          <span className="px-3 py-2 text-sm text-slate-300">{Number(ymAdd(ym, 1).slice(5))}월 →</span>
        ) : (
          <Link href={`/reports?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-100">
            {Number(ymAdd(ym, 1).slice(5))}월 →
          </Link>
        )}
      </div>

      {/* ---- ① 핵심 숫자 ---- */}
      <section className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4">
          <div className="text-sm text-slate-500">매출</div>
          <div className="mt-1 text-3xl font-bold">{fmtWon(cur.amt)}</div>
          <div className="mt-1 space-x-3 text-sm">
            {salesDelta !== null && (
              <Delta v={salesDelta} label={isCurrent ? `전월 1~${todayDay}일 대비` : "전월 대비"} />
            )}
            {yearDelta !== null && <Delta v={yearDelta} label={`작년 ${mm}월 대비`} />}
          </div>
        </div>
        <Tile label="판매 건수" value={`${cur.n}건`} sub={!isCurrent && prev.n > 0 ? `전월 ${prev.n}건` : undefined} />
        <Tile label="건당 평균" value={fmtWon(avg)} />
        <Tile label="새 손님" value={`${g.new_n}명`} sub="이번이 첫 방문" />
        <Tile label="다시 온 손님" value={`${g.ret_n}명`} sub="전에도 온 적 있음" />
      </section>

      {cur.n === 0 && (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-center text-slate-500">
          이 달에는 성사된 판매가 없습니다
        </p>
      )}

      {/* PC 에서 그래프·목록을 나란히 (사장님 승인 2026-08-08) */}
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {/* ---- ② 일별 흐름 ---- */}
      <Section title="일별 매출" sub="막대에 손을 대면 그날의 건수·금액이 뜹니다">
        <ColumnChart data={days} height={170} />
      </Section>

      {/* ---- ③ 12개월 추이 ---- */}
      <Section title="최근 12개월" sub="보고 있는 달이 진한 색입니다">
        <ColumnChart data={trend} height={190} color="#6da7ec" hotColor="#1c5cab" />
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

      {/* ---- ④ 요일별 (사장님 요청 2026-08-08) ---- */}
      <Section
        title="요일별 매출"
        sub={`${isCurrent ? `1~${todayDay}일 기준` : `${mm}월 전체`} · 막대에 손을 대면 건수·하루 평균이 뜹니다`}
      >
        <ColumnChart data={weekBars} height={170} />
      </Section>

      {/* ---- ⑤ 결제수단 ---- */}
      <Section title="결제수단">
        {segs.length ? (
          <>
            <StackedBar parts={segs} clipId="pay-clip" />
            <ul className="mt-3 space-y-1.5">
              {segs.map((s) => (
                <li key={s.label} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
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

      {/* ---- ⑥ 많이 판 품목 ---- */}
      <Section wide title="많이 판 품목 톱10" sub="금액 순 · 막대는 1위 대비 크기">
        {top.length ? (
          /* 🔴 막대를 글자 뒤에 깔지 않는다 (2026-08-07 재고 리포트에서 같은 문제 제보) */
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
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${w}%` }} />
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
        정비한 날(work_date) 기준 · 성사된 판매만 집계 · 마진(매입원가) 각도는 원가 기록이 쌓이면 추가됩니다
      </p>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Delta({ v, label }: { v: number; label: string }) {
  const up = v >= 0;
  return (
    <span className={up ? "text-green-700" : "text-red-600"}>
      {label} {up ? "▲" : "▼"} {Math.abs(v)}%
    </span>
  );
}

function Section({
  title,
  sub,
  wide,
  children,
}: {
  title: string;
  sub?: string;
  /** PC 2열 배치에서 전체 폭 (긴 목록용) */
  wide?: boolean;
  children: React.ReactNode;
}) {
  // 간격은 부모 grid 의 gap 이 준다 — PC 2열 배치와 폰 1열 모두에서 맞는다 (2026-08-08)
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
