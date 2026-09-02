import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { kstToday, ymAdd } from "@/lib/ym";

export const dynamic = "force-dynamic";

/**
 * ⭐ 마진 리포트 (사장님 지시 2026-08-25) — 사장님 전용
 *
 *   판매 줄에 박아 둔 원가 스냅샷(purchase_cost)으로 「남는 장사인가」를 본다.
 *   🔴 원가가 기록된 줄만 셈에 넣는다 — 커버리지(기록 비율)를 함께 보여줘
 *      "이 숫자가 전체의 몇 %를 말하는지" 정직하게 알린다. 대상은 실사용 판매(Q26-…).
 *
 * 🔴 질의 순차 — Promise.all 금지.
 */

const won = (n: number) => n.toLocaleString("ko-KR");
// 감사 L3: 달 계산은 lib/ym 정본

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

  // ② 품목별 마진 TOP (원가 기록된 줄만)
  const items = await db.execute<{ name: string; qty: number; sales: string; margin: string }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           COALESCE(SUM(qi.margin), 0)::bigint margin
    ${BASE} AND qi.purchase_cost IS NOT NULL
    GROUP BY 1 ORDER BY margin DESC LIMIT 12
  `);

  // ③ 제조사별 (타이어 — 상품·브랜드가 이어진 줄만)
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

  const salesAll = Number(tot.sales_all);
  const salesCov = Number(tot.sales_cov);
  const costCov = Number(tot.cost_cov);
  const marginCov = Number(tot.margin_cov);
  const covPct = salesAll > 0 ? Math.round((salesCov / salesAll) * 100) : 0;
  const marginPct = salesCov > 0 ? ((marginCov / salesCov) * 100).toFixed(1) : "0";

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">마진 리포트</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/reports" className="text-slate-600 underline underline-offset-4">매출 리포트</Link>
          <Link href="/finance" className="text-slate-600 underline underline-offset-4">돈 관리</Link>
        </div>
      </header>

      <nav className="tabular mt-2 flex items-center justify-center gap-4 text-sm">
        <Link href={`/reports/margin?ym=${ymAdd(ym, -1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
          ◀ {ymAdd(ym, -1)}
        </Link>
        <span className="font-bold">{ym}</span>
        {ym < thisYm ? (
          <Link href={`/reports/margin?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
            {ymAdd(ym, 1)} ▶
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-slate-300">다음 달</span>
        )}
      </nav>

      {/* 요약 */}
      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4">
        <div className="tabular grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-slate-500">원가 아는 매출</p>
            <p className="mt-1 font-bold">{won(salesCov)}원</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">원가</p>
            <p className="mt-1 font-bold text-slate-600">{won(costCov)}원</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">마진 ({marginPct}%)</p>
            <p className={`mt-1 font-bold ${marginCov >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {won(marginCov)}원
            </p>
          </div>
        </div>
        <p className="tabular mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          이 달 판매 {tot.n_all}줄 중 원가가 기록된 것 {tot.n_cov}줄 — 매출 기준 커버리지{" "}
          <strong>{covPct}%</strong>. 매입(인보이스)이 상품과 이어질수록 올라갑니다 — 위 숫자는
          「원가를 아는 판매」만의 마진입니다.
        </p>
      </section>

      {/* 품목별 */}
      {items.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">품목별 마진 TOP</h2>
          <table className="tabular mt-2 w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 text-left">품목</th>
                <th className="text-right">수량</th>
                <th className="text-right">매출</th>
                <th className="text-right">마진(율)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const s = Number(r.sales);
                const mg = Number(r.margin);
                return (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="max-w-[11rem] truncate py-1">{r.name}</td>
                    <td className="text-right">{r.qty}</td>
                    <td className="text-right">{won(s)}</td>
                    <td className={`text-right ${mg >= 0 ? "" : "text-red-600"}`}>
                      {won(mg)} ({s > 0 ? ((mg / s) * 100).toFixed(0) : 0}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* 제조사별 */}
      {brands.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">제조사별 마진</h2>
          <table className="tabular mt-2 w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 text-left">제조사</th>
                <th className="text-right">수량</th>
                <th className="text-right">매출</th>
                <th className="text-right">마진(율)</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((r) => {
                const s = Number(r.sales);
                const mg = Number(r.margin);
                return (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="py-1">{r.name}</td>
                    <td className="text-right">{r.qty}</td>
                    <td className="text-right">{won(s)}</td>
                    <td className={`text-right ${mg >= 0 ? "" : "text-red-600"}`}>
                      {won(mg)} ({s > 0 ? ((mg / s) * 100).toFixed(0) : 0}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="mt-4 text-xs text-slate-400">
        원가는 파는 순간의 최근 매입 단가(없으면 상품 매입가)를 줄에 박아 둔 값입니다 — 나중에 매입가가
        바뀌어도 그때의 마진은 그대로 남습니다. 실사용 판매(Q26-…)만 대상입니다.
      </p>
    </main>
  );
}
