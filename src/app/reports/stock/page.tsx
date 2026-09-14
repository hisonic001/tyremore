import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { SPEC_SQL } from "@/lib/spec-sql";
import { ColumnChart, StackedBar, fmtShort, fmtWon } from "../charts";
import { Section, Stat, BarList, ReportTabs } from "../ui";
import type { Bar, Segment } from "../charts";

export const dynamic = "force-dynamic";

/**
 * ⭐ 재고 리포트 — 사장님 전용 (2026-08-07 → 2026-09-03 재설계)
 *
 *   "재고 현황을 통해서 홀수타이어를 확인해 주문을 넣거나 …"
 *   + 2026-09-03 사장님: "10개 이상 있는 경우 홀수인 것은 크게 의미가 없으며
 *     차라리 2개도 추가를 해서 **1대분이 안 되는 것들**도 확인이 가능해야 함."
 *
 * 짝 기준 재설계 (실측: 1대분 미만 63종 120본 — 그중 2본이 47종으로 최다):
 *   · 주인공 = **1대분(4본) 미만** (1~3본) — 대차 장착이 안 되는 재고
 *   · 보조   = 4~9본 중 홀수 — 짝 채우기 실익이 있는 구간만
 *   · 10본 이상은 짝 여부를 따지지 않는다 (의미 없음 — 사장님 지시)
 *
 * 각도: ①핵심 숫자(+예약 홀드) ②1대분 미만 ③연식(+오래된 DOT 목록) ④계절
 *       ⑤브랜드 ⑥규격 톱10 ⑦안 나가는 재고.
 * 타이어만 다룬다 — 부품 수량은 미확인이 많아 섞으면 숫자가 거짓말이 된다.
 * 🔴 평가액은 정가(list_price) 기준 — 매입가 기록이 쌓이면 원가 기준 추가.
 */

/** 규격 조립 — 정본은 lib/spec-sql.ts (차량 리포트와 같이 쓴다) */
const SPEC = SPEC_SQL;
const NAME = sql`COALESCE(NULLIF(p.display_name, ''), p.pattern, p.raw_name)`;

export default async function StockReportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("reports"))) redirect("/"); // 권한 스위치 (2026-09-02)

  /**
   * 🔴 쿼리는 **하나씩 차례로** (2026-08-07 — 이 페이지만 Vercel 에서 동시 실행 시
   *    응답이 끝나지 않던 문제). 단계 로그로 어디서 멈추는지 서버 로그에 남긴다.
   */
  const step = (n: string) => console.log(`[재고리포트] ${n} ${Date.now()}`);
  step("시작");

  const kpiRows = await db.execute<{ total: number; products: number; nodot: number; list_sum: string }>(sql`
      SELECT COALESCE(SUM(s.qty),0)::int total, COUNT(DISTINCT s.product_id)::int products,
             COALESCE(SUM(s.qty) FILTER (WHERE s.dot IS NULL),0)::int nodot,
             COALESCE(SUM(s.qty * p.list_price) FILTER (WHERE p.list_price IS NOT NULL),0)::bigint list_sum
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire'
    `);
  step("① 총괄");

  /* ⭐ 예약 홀드 (2026-09-03) — 예약중 판매에 묶인 타이어. 판매를 막진 않지만 셈에 넣어야 한다 */
  const reservedRows = await db.execute<{ q: number; models: number }>(sql`
      SELECT COALESCE(SUM(i.qty),0)::int q, COUNT(DISTINCT i.product_id)::int models
      FROM quote_item i
      JOIN quote qq ON qq.id = i.quote_id
      JOIN product p ON p.id = i.product_id
      WHERE qq.status = '성사' AND qq.reservation_status = '예약중' AND p.item_type = 'tire'
    `);
  step("①-2 예약 홀드");

  /* ⭐ 짝 기준 재설계 (사장님 지시 2026-09-03) — 10본 미만만 가져와 화면에서 가른다 */
  const small = await db.execute<{ spec: string | null; name: string; qty: number }>(sql`
      SELECT ${SPEC} AS spec, ${NAME} AS name, SUM(s.qty)::int qty
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY p.id, 1, 2
      HAVING SUM(s.qty) < 10
      ORDER BY SUM(s.qty), 1 NULLS LAST, 2
    `);
  step("② 1대분 미만·홀수");

  const years = await db.execute<{ y: string; n: number }>(sql`
      SELECT ('20' || substr(s.dot, 3, 2)) y, SUM(s.qty)::int n
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire' AND s.dot IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `);
  step("③ 연식");

  /* ⭐ 오래된 DOT 목록 (2026-09-03) — 3년 이상 된 실물이 무엇인지 (차트만으론 못 팔러 간다) */
  const oldDots = await db.execute<{ spec: string | null; name: string; y: string; qty: number }>(sql`
      SELECT ${SPEC} AS spec, ${NAME} AS name, ('20' || substr(s.dot, 3, 2)) y, SUM(s.qty)::int qty
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire' AND s.dot IS NOT NULL
        AND ('20' || substr(s.dot, 3, 2))::int <= EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Seoul')::int - 3
      GROUP BY p.id, 1, 2, 3
      ORDER BY 3, SUM(s.qty) DESC LIMIT 14
    `);
  step("③-2 오래된 DOT");

  const seasons = await db.execute<{ se: string; n: number }>(sql`
      SELECT COALESCE(p.season, '미상') se, SUM(s.qty)::int n
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY 1
    `);
  step("④ 계절");

  const brands = await db.execute<{ bn: string; n: number }>(sql`
      SELECT COALESCE(b.name_ko, p.brand_code, '기타') bn, SUM(s.qty)::int n
      FROM stock_item s JOIN product p ON p.id = s.product_id
      LEFT JOIN brand b ON b.code = p.brand_code
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY 1 ORDER BY n DESC
    `);
  step("⑤ 브랜드");

  const specs = await db.execute<{ spec: string; n: number }>(sql`
      SELECT ${SPEC} AS spec, SUM(s.qty)::int n
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY 1 HAVING ${SPEC} IS NOT NULL
      ORDER BY n DESC LIMIT 10
    `);
  step("⑥ 규격");

  const notSelling = await db.execute<{ spec: string | null; name: string; qty: number; last_sold: string | null }>(sql`
      WITH last_sale AS (
        SELECT qi.product_id, MAX(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)) d
        FROM quote_item qi JOIN quote q ON q.id = qi.quote_id AND q.status = '성사'
        WHERE qi.product_id IS NOT NULL GROUP BY 1
      )
      SELECT ${SPEC} AS spec, ${NAME} AS name, SUM(s.qty)::int qty, ls.d::text AS last_sold
      FROM stock_item s
      JOIN product p ON p.id = s.product_id
      LEFT JOIN last_sale ls ON ls.product_id = p.id
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY p.id, 1, 2, ls.d
      HAVING COALESCE(ls.d, '2000-01-01'::date) < (now() AT TIME ZONE 'Asia/Seoul')::date - 180
      ORDER BY SUM(s.qty) DESC, 1 LIMIT 10
    `);
  step("⑦ 안 나가는 재고 — 쿼리 전부 끝");

  const kpi = kpiRows[0] ?? { total: 0, products: 0, nodot: 0, list_sum: "0" };
  const reserved = reservedRows[0] ?? { q: 0, models: 0 };

  /* 짝 기준: 1~3본 = 1대분 미만(주인공) · 4~9본 홀수 = 짝 어긋남(보조) */
  const underSet = small.filter((r) => r.qty <= 3);
  const oddMid = small.filter((r) => r.qty >= 4 && r.qty % 2 === 1);
  const underQty = underSet.reduce((s, r) => s + r.qty, 0);

  const yearBars: Bar[] = years.map((r) => ({
    label: `${r.y}년`,
    value: r.n,
    hint: `${r.y}년산 · ${r.n}본`,
    hot: Number(r.y) <= new Date().getFullYear() - 2,
  }));
  const oldDotQty = oldDots.reduce((s, r) => s + r.qty, 0);

  /** 계절 색 고정 배정 — 검증된 팔레트, 변경 금지 */
  const SEASON_ORDER: [string, string][] = [
    ["사계절", "#2a78d6"],
    ["여름", "#eb6834"],
    ["겨울", "#1baf7a"],
    ["올웨더", "#eda100"],
    ["미상", "#898781"],
  ];
  const bySeason = new Map(seasons.map((r) => [r.se, r.n]));
  const segs: Segment[] = SEASON_ORDER.filter(([k]) => (bySeason.get(k) ?? 0) > 0).map(([k, color]) => ({
    label: k,
    value: bySeason.get(k)!,
    color,
  }));

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">재고 리포트</h1>
        <ReportTabs active="stock" />
      </header>

      {/* ---- ① 헤드라인 — 큰 숫자 하나 + 보조 줄 (토스풍, 2026-09-03) ---- */}
      <section className="mt-4 rounded-card border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">타이어 재고</span>
          <Link href="/stock" className="text-xs text-slate-400 underline underline-offset-4">
            창고 세기 화면 →
          </Link>
        </div>
        <div className="tabular mt-1 text-[34px] font-extrabold leading-tight tracking-tight">{kpi.total}본</div>
        <div className="tabular mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="모델 수" value={`${kpi.products}개`} />
          <Stat label="정가 기준 평가액" value={`${fmtShort(Number(kpi.list_sum))}원`} sub="원가 기준은 기록이 쌓이면" />
          <Stat
            label="1대분(4본) 미만"
            value={`${underSet.length}종 ${underQty}본`}
            sub="아래 목록 — 채우거나 먼저 팔 것"
          />
          <Stat
            label="예약 걸림"
            value={reserved.q > 0 ? `${reserved.q}본` : "없음"}
            sub={reserved.q > 0 ? `${reserved.models}개 모델 — 시공 전 예약분` : undefined}
            href={reserved.q > 0 ? "/sales?reserved=1&range=all" : undefined}
          />
          <Stat label="DOT 미입력" value={`${kpi.nodot}본`} sub="창고 세기 화면에서 채우기" />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* ---- ② 1대분 미만 — 이 리포트의 주인공 (기준 재설계 2026-09-03) ---- */}
        <Section
          wide
          title={`1대분(4본)이 안 되는 타이어 ${underSet.length}종`}
          sub="2본은 앞뒤 한 짝뿐, 1·3본은 짝도 안 맞습니다 — 채워 주문하거나 먼저 파세요"
        >
          {underSet.length ? (
            <ul className="grid grid-cols-1 gap-1 lg:grid-cols-2">
              {underSet.map((r, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {r.spec && <strong className="tabular mr-1.5">{r.spec}</strong>}
                    {r.name}
                  </span>
                  <span className="tabular shrink-0 font-bold text-amber-800">
                    {r.qty}본
                    {r.qty % 2 === 1 && <span className="ml-1 text-[11px] font-medium text-amber-600">홀수</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">전 모델이 1대분 이상입니다 👍</p>
          )}
          {oddMid.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-400">
                4~9본인데 홀수인 것 {oddMid.length}종 (짝 채우기 후보 · 10본 이상은 안 따집니다)
              </summary>
              <ul className="mt-1.5 grid grid-cols-1 gap-1 lg:grid-cols-2">
                {oddMid.map((r, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      {r.spec && <strong className="tabular mr-1.5">{r.spec}</strong>}
                      {r.name}
                    </span>
                    <span className="tabular shrink-0 font-semibold text-slate-700">{r.qty}본</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        {/* ---- ③ 연식 (DOT) + 오래된 실물 목록 ---- */}
        <Section title="연식 (DOT)" sub={`오래된 것부터 파세요 · DOT 미입력 ${kpi.nodot}본은 여기 빠져 있습니다`}>
          {yearBars.length ? <ColumnChart data={yearBars} height={160} unit="본" /> : <p className="text-sm text-slate-400">DOT 기록이 없습니다</p>}
          {oldDots.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-slate-400">3년 이상 된 실물 {oldDotQty}본 — 먼저 팔 것</p>
              <ul className="mt-1.5 space-y-1">
                {oldDots.map((r, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-700">
                      {r.spec && <strong className="tabular mr-1.5">{r.spec}</strong>}
                      {r.name}
                    </span>
                    <span className="tabular shrink-0 text-xs text-slate-500">
                      {r.y}년산 <strong className="ml-1 text-sm text-slate-900">{r.qty}본</strong>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* ---- ④ 계절 구성 ---- */}
        <Section title="계절 구성" sub="겨울 오기 전에 겨울 재고를 가늠할 때">
          {segs.length ? (
            <>
              <StackedBar parts={segs} clipId="season-clip" />
              <ul className="mt-3 space-y-1.5">
                {segs.map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </span>
                    <span className="tabular font-medium">
                      {s.value}본
                      <span className="ml-2 text-slate-400">{kpi.total > 0 ? Math.round((s.value / kpi.total) * 100) : 0}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-400">재고가 없습니다</p>
          )}
        </Section>

        {/* ---- ⑤ 브랜드별 ---- */}
        <Section title="브랜드별 본수">
          <BarList rows={brands.map((b) => ({ key: b.bn, label: b.bn, value: `${b.n}본`, weight: b.n }))} />
        </Section>

        {/* ---- ⑥ 규격별 톱10 ---- */}
        <Section title="많이 쌓인 규격 톱10" sub="주문 전에 이미 많은 규격인지 확인">
          <BarList rows={specs.map((r) => ({ key: r.spec, label: r.spec, value: `${r.n}본`, weight: r.n }))} />
        </Section>

        {/* ---- ⑦ 안 나가는 재고 ---- */}
        <Section wide title="안 나가는 재고" sub="재고는 있는데 최근 6개월 판매가 없는 모델 — 처분·행사 후보">
          {notSelling.length ? (
            <ul className="grid grid-cols-1 gap-1 lg:grid-cols-2">
              {notSelling.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {r.spec && <strong className="tabular mr-1.5">{r.spec}</strong>}
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    <strong className="tabular mr-1 text-sm text-slate-900">{r.qty}본</strong>
                    {r.last_sold ? `마지막 판매 ${r.last_sold}` : "판매 기록 없음"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">최근 6개월 안에 다 한 번씩은 팔렸습니다 👍</p>
          )}
        </Section>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        타이어(재고 상태)만 집계 · 부품 수량은 미확인이 많아 뺐습니다 · 평가액은 정가 기준 {fmtWon(Number(kpi.list_sum))}
      </p>
    </main>
  );
}
