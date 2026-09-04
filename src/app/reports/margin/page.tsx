import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { kstToday, ymAdd } from "@/lib/ym";
import { ColumnChart, fmtShort } from "../charts";
import type { Bar } from "../charts";
import { Section, Stat, BarList } from "../ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 마진 리포트 (사장님 지시 2026-08-25 → 2026-09-03 확장·리프레시) — 사장님 전용
 *
 *   판매 줄에 박아 둔 원가 스냅샷(purchase_cost)으로 「남는 장사인가」를 본다.
 *   + 2026-09-03: 월별 마진율 추이 · 원가 미기록 매출 TOP(커버리지 올리기 액션) ·
 *     제조사별 그래픽, 토스풍 리프레시.
 *   🔴 원가가 기록된 줄만 셈에 넣는다 — 커버리지(기록 비율)를 함께 보여줘
 *      "이 숫자가 전체의 몇 %를 말하는지" 정직하게 알린다. 대상은 실사용 판매(Q26-…).
 *
 * 🔴 질의 순차 — Promise.all 금지.
 */

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function MarginReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("reports"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const thisYm = kstToday().slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;
  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  const trendStart = `${ymAdd(ym, -11)}-01`;
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const BASE = sql`FROM quote_item qi
    JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date`;

  // ① 이 달 합계 + 커버리지
  const [tot] = await db.execute<{
    sales_all: string; n_all: number; sales_cov: string; cost_cov: string; margin_cov: string; n_cov: number;
  }>(sql`
    SELECT COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales_all, count(*)::int n_all,
           COALESCE(SUM(qi.final_price * qi.qty) FILTER (WHERE qi.purchase_cost IS NOT NULL), 0)::bigint sales_cov,
           COALESCE(SUM(qi.purchase_cost * qi.qty) FILTER (WHERE qi.purchase_cost IS NOT NULL), 0)::bigint cost_cov,
           COALESCE(SUM(qi.margin) FILTER (WHERE qi.purchase_cost IS NOT NULL), 0)::bigint margin_cov,
           count(*) FILTER (WHERE qi.purchase_cost IS NOT NULL)::int n_cov
    ${BASE}
  `);

  /* ② ⭐ 월별 마진율 추이 12개월 (2026-09-03) — 커버리지가 낮은 달은 풍선에 함께 밝힌다 */
  const trendRows = await db.execute<{ ym: string; m: string; base: string; total: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM') ym,
           COALESCE(SUM(qi.margin) FILTER (WHERE qi.purchase_cost IS NOT NULL), 0)::bigint m,
           COALESCE(SUM(qi.final_price * qi.qty) FILTER (WHERE qi.purchase_cost IS NOT NULL), 0)::bigint base,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint total
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%'
      AND ${D} >= ${trendStart}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 ORDER BY 1
  `);

  // ③ 품목별 마진 TOP (원가 기록된 줄만)
  const items = await db.execute<{ name: string; qty: number; sales: string; margin: string }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           COALESCE(SUM(qi.margin), 0)::bigint margin
    ${BASE} AND qi.purchase_cost IS NOT NULL
    GROUP BY 1 ORDER BY margin DESC LIMIT 12
  `);

  // ④ 제조사별 (타이어 — 상품·브랜드가 이어진 줄만)
  const brands = await db.execute<{ name: string; qty: number; sales: string; margin: string }>(sql`
    SELECT COALESCE(b.name_ko, '기타') name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           COALESCE(SUM(qi.margin), 0)::bigint margin
    FROM quote_item qi
    JOIN quote q ON q.id = qi.quote_id
    LEFT JOIN product p ON p.id = qi.product_id
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND qi.purchase_cost IS NOT NULL
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 ORDER BY margin DESC LIMIT 10
  `);

  /* ⑤ ⭐ 원가 미기록 매출 TOP (2026-09-03) — 이걸 채우면 커버리지가 올라간다 (행동 목록) */
  const uncov = await db.execute<{ name: string; qty: number; sales: string; is_product: boolean }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           bool_or(qi.product_id IS NOT NULL) is_product
    ${BASE} AND qi.purchase_cost IS NULL AND qi.final_price > 0
    GROUP BY 1 ORDER BY 3 DESC LIMIT 8
  `);

  const salesAll = Number(tot.sales_all);
  const salesCov = Number(tot.sales_cov);
  const costCov = Number(tot.cost_cov);
  const marginCov = Number(tot.margin_cov);
  const covPct = salesAll > 0 ? Math.round((salesCov / salesAll) * 100) : 0;
  const marginPct = salesCov > 0 ? ((marginCov / salesCov) * 100).toFixed(1) : "0";

  const trend: Bar[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = ymAdd(ym, -i);
    const r = trendRows.find((t) => t.ym === k);
    const base = r ? Number(r.base) : 0;
    const ratePm = r && base > 0 ? (Number(r.m) / base) * 100 : 0;
    const cov = r && Number(r.total) > 0 ? Math.round((base / Number(r.total)) * 100) : 0;
    const [, km] = k.split("-").map(Number);
    trend.push({
      label: `${km}월`,
      value: Math.max(0, Math.round(ratePm * 10) / 10),
      hint: `${k} · 마진율 ${ratePm.toFixed(1)}% · 커버리지 ${cov}%`,
      hot: k === ym,
    });
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">마진 리포트</h1>
        <div className="flex gap-1">
          <Link href="/reports" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            매출
          </Link>
          <Link href="/reports/stock" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            재고
          </Link>
          <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">마진</span>
          <Link href="/reports/mars" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100">
            MARS
          </Link>
        </div>
      </header>

      {/* ---- ① 헤드라인 — 이 달 마진 (토스풍, 2026-09-03) ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {ym.slice(0, 4)}년 {Number(ym.slice(5))}월 마진 <span className="text-slate-400">· 원가 아는 판매 기준</span>
          </span>
          <span className="flex items-center gap-1 text-sm">
            <Link href={`/reports/margin?ym=${ymAdd(ym, -1)}`} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
              ←
            </Link>
            {ym < thisYm ? (
              <Link href={`/reports/margin?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-2 py-1 text-slate-400 active:bg-slate-100">
                →
              </Link>
            ) : (
              <span className="px-2 py-1 text-slate-200">→</span>
            )}
          </span>
        </div>
        <div className={`tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight ${marginCov >= 0 ? "" : "text-red-600"}`}>
          {won(marginCov)}원
        </div>
        <div className="mt-1.5">
          <span className="tabular inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            마진율 {marginPct}%
          </span>
          <span className="tabular ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            커버리지 {covPct}%
          </span>
        </div>
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          <Stat label="원가 아는 매출" value={`${won(salesCov)}원`} sub={`${tot.n_cov}줄 / 전체 ${tot.n_all}줄`} />
          <Stat label="원가" value={`${won(costCov)}원`} />
          <Stat label="원가 모르는 매출" value={`${won(salesAll - salesCov)}원`} sub="아래 목록을 채우면 줄어듭니다" />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- ② 월별 마진율 추이 (2026-09-03) ---- */}
        <Section wide title="월별 마진율 추이" sub="막대에 손을 대면 그 달의 커버리지도 뜹니다 — 커버리지가 낮은 달의 마진율은 참고만">
          <ColumnChart data={trend} height={170} unit="%" />
        </Section>

        {/* ---- ③ 원가 미기록 매출 TOP (2026-09-03) — 커버리지 올리기 행동 목록 ---- */}
        <Section
          title="원가를 모르는 매출 TOP"
          sub="이 품목들의 매입가를 채우면 마진 숫자가 정확해집니다"
        >
          {uncov.length ? (
            <BarList
              color="#eda100"
              rows={uncov.map((r) => ({
                key: r.name,
                label: r.name,
                note: `${r.qty}개 · `,
                value: `${fmtShort(Number(r.sales))}`,
                weight: Number(r.sales),
              }))}
            />
          ) : (
            <p className="text-sm text-slate-400">이 달 판매는 전부 원가가 기록돼 있습니다 👍</p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            상품과 이어진 줄은 매입 입고에서 단가를 채우면, 공임·기타 줄은 원래 원가가 없습니다.
          </p>
        </Section>

        {/* ---- ④ 제조사별 마진 (그래픽, 2026-09-03) ---- */}
        <Section title="제조사별 마진" sub="원가 아는 타이어 판매 기준 · 괄호는 마진율">
          {brands.length ? (
            <BarList
              rows={brands.map((r) => {
                const s = Number(r.sales);
                const mg = Number(r.margin);
                return {
                  key: r.name,
                  label: r.name,
                  note: `${r.qty}본 · `,
                  value: `${fmtShort(mg)} (${s > 0 ? ((mg / s) * 100).toFixed(0) : 0}%)`,
                  weight: Math.max(0, mg),
                };
              })}
            />
          ) : (
            <p className="text-sm text-slate-400">원가가 기록된 타이어 판매가 아직 없습니다</p>
          )}
        </Section>

        {/* ---- ⑤ 품목별 마진 TOP ---- */}
        <Section title="품목별 마진 TOP" sub="원가 아는 줄만 · 괄호는 마진율">
          {items.length ? (
            <ul className="tabular space-y-1.5 text-sm">
              {items.map((r) => {
                const s = Number(r.sales);
                const mg = Number(r.margin);
                return (
                  <li key={r.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{r.name}</span>
                    <span className={`shrink-0 ${mg >= 0 ? "text-slate-700" : "font-semibold text-red-600"}`}>
                      <span className="mr-1 text-xs text-slate-400">{r.qty}개</span>
                      <strong className={mg >= 0 ? "text-slate-900" : "text-red-600"}>{won(mg)}원</strong>
                      <span className="ml-1 text-xs text-slate-400">({s > 0 ? ((mg / s) * 100).toFixed(0) : 0}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">원가가 기록된 판매가 아직 없습니다</p>
          )}
        </Section>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        원가는 파는 순간의 최근 매입 단가(없으면 상품 매입가)를 줄에 박아 둔 값입니다 — 나중에 매입가가
        바뀌어도 그때의 마진은 그대로 남습니다. 실사용 판매(Q26-…)만 대상입니다.
      </p>
    </main>
  );
}
