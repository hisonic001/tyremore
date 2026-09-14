import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { marginSql, marginBaseSql } from "@/lib/margin-def";
import { kstToday, ymAdd } from "@/lib/ym";
import { estimateRebates, listRebateEntries, oilAllocation } from "@/lib/rebate";
import { ColumnChart, fmtShort } from "../charts";
import type { Bar } from "../charts";
import { Section, Stat, BarList, ReportTabs } from "../ui";
import { RebateEntries } from "./rebate-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 마진 리포트 (사장님 지시 2026-08-25 → 2026-09-03 확장·리프레시) — 사장님 전용
 *
 *   판매 줄에 박아 둔 원가 스냅샷(purchase_cost)으로 「남는 장사인가」를 본다.
 *   + 2026-09-03: 월별 마진율 추이 · 원가 미기록 매출 TOP(커버리지 올리기 액션) ·
 *     제조사별 그래픽, 토스풍 리프레시.
 *   + 2026-09-04: 마진 정의 개정 — 정본은 lib/margin-def.ts (공임 매출 포함,
 *     소모품 원가 차감; 옛 정의는 9월 마진을 -29.9만으로 보여주는 거짓말을 했다).
 *   🔴 원가 모르는 물품 줄은 셈에서 뺀다 — 커버리지(포함 비율)를 함께 보여줘
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

  // ① 이 달 합계 — 새 정의(margin-def.ts) + 구성 분해(물품·공임·소모품)
  const [tot] = await db.execute<{
    sales_all: string; n_all: number; base_new: string; margin_new: string;
    goods_margin: string; service_sales: string; use_cost: string;
  }>(sql`
    SELECT COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales_all, count(*)::int n_all,
           COALESCE(SUM(${marginBaseSql}), 0)::bigint base_new,
           COALESCE(SUM(${marginSql}), 0)::bigint margin_new,
           COALESCE(SUM(qi.margin) FILTER (WHERE qi.purchase_cost IS NOT NULL AND qi.line_type <> 'use'), 0)::bigint goods_margin,
           COALESCE(SUM(qi.final_price * qi.qty) FILTER (WHERE qi.line_type = 'service'), 0)::bigint service_sales,
           COALESCE(SUM(qi.purchase_cost * qi.qty) FILTER (WHERE qi.line_type = 'use'), 0)::bigint use_cost
    ${BASE}
  `);

  /* ② ⭐ 월별 마진율 추이 12개월 (2026-09-03, 정의 개정 09-04) — 커버리지 낮은 달은 풍선에 밝힌다 */
  const trendRows = await db.execute<{ ym: string; m: string; base: string; total: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM') ym,
           COALESCE(SUM(${marginSql}), 0)::bigint m,
           COALESCE(SUM(${marginBaseSql}), 0)::bigint base,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint total
    FROM quote_item qi JOIN quote q ON q.id = qi.quote_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%'
      AND ${D} >= ${trendStart}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 ORDER BY 1
  `);

  /* ③ 품목별 마진 TOP — 판매한 물품만. 소모품(use)은 여기 안 섞는다 (2026-09-04:
   *   9월 목록 14줄 중 12줄이 0원 판매 소모품의 마이너스로 도배돼 착시를 만들었다) */
  const items = await db.execute<{ name: string; qty: number; sales: string; margin: string }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           COALESCE(SUM(qi.margin), 0)::bigint margin
    ${BASE} AND qi.purchase_cost IS NOT NULL AND qi.line_type <> 'use'
    GROUP BY 1 ORDER BY margin DESC LIMIT 12
  `);

  /* ③-b ⭐ 정비에 쓴 소모품 (2026-09-04) — 공임 매출에 녹아 있는 원가. 접힌 목록으로 */
  const useRows = await db.execute<{ name: string; qty: number; cost: string }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.purchase_cost * qi.qty), 0)::bigint cost
    ${BASE} AND qi.line_type = 'use' AND qi.purchase_cost IS NOT NULL
    GROUP BY 1 ORDER BY 3 DESC LIMIT 40
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
      AND qi.line_type <> 'use' -- 소모품 원가가 브랜드에 마이너스로 깔리는 것 방지 (2026-09-04)
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 ORDER BY margin DESC LIMIT 10
  `);

  /* ⑤ ⭐ 원가 미기록 매출 TOP (2026-09-03) — 이걸 채우면 커버리지가 올라간다 (행동 목록) */
  const uncov = await db.execute<{ name: string; qty: number; sales: string; is_product: boolean }>(sql`
    SELECT qi.description name, SUM(qi.qty)::int qty,
           COALESCE(SUM(qi.final_price * qi.qty), 0)::bigint sales,
           bool_or(qi.product_id IS NOT NULL) is_product
    ${BASE} AND qi.purchase_cost IS NULL AND qi.final_price > 0
      AND qi.line_type <> 'service' -- 공임은 새 정의에서 전액 마진 — 원가 미기록이 아니다 (2026-09-04)
    GROUP BY 1 ORDER BY 3 DESC LIMIT 8
  `);

  /* ⭐ 뒷마진(장려금)·오일 배부 (2026-09-09, 전문가 2인 자문) — 질의 순차 */
  const rebateCards = await estimateRebates(ym);
  const rebateEntries = await listRebateEntries(ym);
  const oil = await oilAllocation(ym);

  const salesAll = Number(tot.sales_all);
  const baseNew = Number(tot.base_new); // 마진에 포함된 매출 (물품 원가 아는 것 + 공임)
  const marginNew = Number(tot.margin_new);
  const goodsMargin = Number(tot.goods_margin);
  const serviceSales = Number(tot.service_sales);
  const useCost = Number(tot.use_cost);
  const covPct = salesAll > 0 ? Math.round((baseNew / salesAll) * 100) : 0;
  const marginPct = baseNew > 0 ? ((marginNew / baseNew) * 100).toFixed(1) : "0";
  const useTotal = useRows.reduce((s, r) => s + Number(r.cost), 0);

  const rebateEstimate = rebateCards.reduce((s, c) => s + c.estimate, 0);
  const rebateFixed = rebateEntries.reduce((s, e) => s + e.amount, 0);
  const trueMargin = marginNew + rebateFixed - oil.total; // 확정만 — 추정은 참고 표기

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

      <header className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">마진 리포트</h1>
        <ReportTabs active="margin" />
      </header>

      {/* ---- ① 헤드라인 — 이 달 마진 (토스풍, 2026-09-03) ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {ym.slice(0, 4)}년 {Number(ym.slice(5))}월 마진 <span className="text-slate-400">· 공임 포함</span>
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
        <div className={`tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight ${marginNew >= 0 ? "" : "text-red-600"}`}>
          {won(marginNew)}원
        </div>
        <div className="mt-1.5">
          <span className="tabular inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            마진율 {marginPct}%
          </span>
          <span className="tabular ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            커버리지 {covPct}%
          </span>
        </div>
        {/* ⭐ 구성 분해 (정의 개정 2026-09-04) — 이 숫자가 어떻게 나왔는지 그 자리에서 보인다 */}
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
          <Stat label="물품 마진" value={`${won(goodsMargin)}원`} sub="원가 아는 판매만" />
          <Stat label="공임" value={`+${won(serviceSales)}원`} sub="전액 마진으로 봄" />
          <Stat label="정비에 쓴 소모품" value={`−${won(useCost)}원`} sub="필터·배터리 등 원가" />
          <Stat label="원가 모르는 매출" value={`${won(salesAll - baseNew)}원`} sub="계산에서 뺌 — 아래 목록" />
        </div>
        <p className="mt-3 text-[11px] leading-tight text-slate-400">
          공임에는 인건비가 빠져 있지 않습니다. 엔진오일 원가는{" "}
          {oil.total > 0 ? "아래 뒷마진 칸에서 월 매입 총액으로 차감됩니다" : "오일 매입 전표를 앱에 넣기 시작하면 자동 차감됩니다 (아직 미입력)"}.
        </p>
      </section>

      {/* ---- ①-b ⭐ 뒷마진(제조사 장려금) + 진짜 마진 (2026-09-09, 전문가 2인 자문) ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="font-bold">
          뒷마진 <span className="text-sm font-normal text-slate-400">— 제조사 장려금·행사 (기간이 지나면 자동으로 사라짐)</span>
        </h2>

        <ul className="mt-3 space-y-3">
          {rebateCards.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{c.title}</span>
                <span className="tabular shrink-0 text-sm">
                  {c.estimate > 0 ? (
                    <>
                      <strong>{won(c.estimate)}원</strong>
                      <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">추정</span>
                    </>
                  ) : (
                    <span className="text-slate-400">0원</span>
                  )}
                </span>
              </div>
              {c.gaugePct !== null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${c.gaugePct >= 100 ? "bg-emerald-500" : "bg-amber-400"}`}
                    style={{ width: `${Math.min(100, c.gaugePct)}%` }}
                  />
                </div>
              )}
              <p className="tabular mt-1.5 text-xs text-slate-500">{c.statusLine}</p>
              {c.actionLine && <p className="tabular mt-1 text-xs font-semibold text-amber-700">{c.actionLine}</p>}
              {c.warnLine && <p className="mt-1 text-[11px] text-slate-400">{c.warnLine}</p>}
            </li>
          ))}
          {rebateCards.length === 0 && <li className="text-sm text-slate-400">이 달에 걸린 프로모션이 없습니다</li>}
        </ul>

        <RebateEntries ym={ym} entries={rebateEntries} />

        {/* 합계 — 확정만 마진으로, 추정은 참고 (세무 자문: 분리 표기가 혼동을 막는다) */}
        <div className="tabular mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>앞마진 (판매)</span>
            <span>{won(marginNew)}원</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>+ 확정 뒷마진</span>
            <span>{won(rebateFixed)}원</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>− 엔진오일 원가 배부{oil.jobs > 0 && oil.total > 0 ? ` (오일교환 ${oil.jobs}건, 건당 약 ${won(Math.round(oil.total / oil.jobs))}원)` : ""}</span>
            <span>{oil.total > 0 ? `−${won(oil.total)}원` : "미입력"}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>진짜 마진 (확정 기준)</span>
            <span>{won(trueMargin)}원</span>
          </div>
          {rebateEstimate > 0 && (
            <div className="flex justify-between text-xs text-slate-400">
              <span>추정 뒷마진까지 들어오면</span>
              <span>{won(trueMargin + rebateEstimate)}원</span>
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-tight text-slate-400">
          「추정」은 실적 기반 계산일 뿐 아직 내 돈이 아닙니다 — 도착하면 확정 등록해야 합계에 들어갑니다. 미쉐린
          캠페인·멤버십 리베이트는 통장에 <strong>㈜트랜스코스모스</strong> 이름으로 입금됩니다 — 그 입금이 뜨면 여기
          등록하세요. 인보이스 단가에 이미 깎여 들어온 지원(미쉐린 즉시할인·금호 볼륨/특판)은 매입 원가에 반영돼 있어 여기
          안 넣습니다(이중 계상 방지). 새 행사 안내문이 오면 Claude 에게 주시면 추가됩니다.
        </p>
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
          {/* ⭐ 정비에 쓴 소모품 (2026-09-04) — 마이너스 품목으로 나열하지 않고 묶어서.
                0원 판매 + 원가만 기록된 줄들 — 돈은 공임 줄로 받았다 */}
          {useRows.length > 0 && (
            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="tabular cursor-pointer text-sm text-slate-500">
                정비에 쓴 소모품 {useRows.length}종 · 원가 −{won(useTotal)}원
                <span className="ml-1 text-xs text-slate-400">(공임 매출에 녹아 있음 — 눌러서 내역)</span>
              </summary>
              <ul className="tabular mt-2 space-y-1 text-sm text-slate-500">
                {useRows.map((r) => (
                  <li key={r.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{r.name}</span>
                    <span className="shrink-0">
                      <span className="mr-1 text-xs text-slate-400">{r.qty}개</span>−{won(Number(r.cost))}원
                    </span>
                  </li>
                ))}
              </ul>
            </details>
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
