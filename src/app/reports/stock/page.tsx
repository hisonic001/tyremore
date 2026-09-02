import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { ColumnChart, StackedBar, fmtShort, fmtWon } from "../charts";
import type { Bar, Segment } from "../charts";

export const dynamic = "force-dynamic";

/**
 * ⭐ 재고 리포트 — 사장님 전용 (사장님 요청 2026-08-07)
 *
 *   "재고 현황을 통해서 홀수타이어를 확인해 주문을 넣거나 하는 등의
 *    우리 가게에서 필요한 여러 정보들을 얻을 수 있었으면 좋겠음."
 *
 * 각도: ①홀수 재고(짝 안 맞는 타이어 — 주문·판매 결정의 근거) ②연식(DOT)
 *       ③계절 구성 ④브랜드·규격별 ⑤안 나가는 재고(최근 반 년 판매 0).
 * 타이어만 다룬다 — 부품 수량은 미확인이 많아 여기 섞으면 숫자가 거짓말이 된다.
 *
 * 🔴 재고 평가액은 **정가(list_price) 기준**이다. 매입가는 기록된 것이
 *    4본뿐이라(2026-08-07 실측) 매입가 기준 평가는 아직 거짓말이 된다.
 */

/** 규격 조립 — sale-history 와 같은 식. 편평비 80 은 생략(145R13, 사장님 지시 2026-08-08) */
const SPEC = sql`
  CASE WHEN p.width IS NOT NULL AND p.rim_inch IS NOT NULL THEN
    p.width::text || COALESCE('/' || NULLIF(p.aspect_ratio, 80)::text, '')
      || 'R' || regexp_replace(p.rim_inch::text, '\.0$', '')
  END`;
const NAME = sql`COALESCE(NULLIF(p.display_name, ''), p.pattern, p.raw_name)`;

export default async function StockReportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("reports"))) redirect("/"); // 권한 스위치 (2026-09-02)

  /**
   * 🔴 쿼리는 **하나씩 차례로** 실행한다 (2026-08-07 — 이 페이지만 Vercel 에서
   *    응답이 끝나지 않는 문제. 같은 7개를 동시에 돌리면 로컬에선 190ms 에 끝나는데
   *    Vercel 렌더는 로그도 없이 멈췄다). 차례로 돌리면 서울 리전에서 왕복을 더해도
   *    0.1초 차이가 안 난다 — 동시성 하나를 의심 목록에서 지우고, 단계 로그로
   *    어디서 멈추는지 서버 로그에 남긴다.
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

  // ⭐ 홀수 재고 — 타이어는 짝(2·4본)으로 나가니 홀수로 남은 모델이 주문·판매 결정 지점이다
  const odd = await db.execute<{ spec: string | null; name: string; qty: number }>(sql`
      SELECT ${SPEC} AS spec, ${NAME} AS name, SUM(s.qty)::int qty
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire'
      GROUP BY p.id, 1, 2
      HAVING SUM(s.qty) % 2 = 1
      ORDER BY 1 NULLS LAST, 2
    `);
  step("② 홀수");

  const years = await db.execute<{ y: string; n: number }>(sql`
      SELECT ('20' || substr(s.dot, 3, 2)) y, SUM(s.qty)::int n
      FROM stock_item s JOIN product p ON p.id = s.product_id
      WHERE s.status = '재고' AND p.item_type = 'tire' AND s.dot IS NOT NULL
      GROUP BY 1 ORDER BY 1
    `);
  step("③ 연식");

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

  // ⭐ 안 나가는 재고 — 재고는 있는데 최근 180일 판매가 없는 모델 (판매 이력은 2025년부터 있다)
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
  const oddQty = odd.reduce((s, r) => s + r.qty, 0);

  const yearBars: Bar[] = years.map((r) => ({
    label: `${r.y}년`,
    value: r.n,
    hint: `${r.y}년산 · ${r.n}본`,
    hot: Number(r.y) <= new Date().getFullYear() - 2, // 2년 넘은 연식은 진하게 — 먼저 팔 것
  }));

  /** 계절 색 고정 배정 — 검증된 팔레트 순서(파랑·주황·아쿠아·노랑) 그대로라 인접쌍이 안전하다 */
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

  const brandMax = brands.length ? brands[0].n : 0;
  const specMax = specs.length ? specs[0].n : 0;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">재고 리포트</h1>
        <span className="text-xs text-slate-400">사장님 전용</span>
      </header>

      {/* 매출 ↔ 재고 오가기 */}
      <div className="mt-3 flex gap-1.5">
        <Link href="/reports" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
          매출
        </Link>
        <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">재고</span>
        {/* ⭐ MARS 입력 평가 (사장님 요청 2026-08-10) */}
        <Link href="/reports/mars" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">
          MARS 평가
        </Link>
        <Link
          href="/stock"
          className="ml-auto rounded-lg px-3 py-1.5 text-sm text-slate-500 underline underline-offset-4"
        >
          창고 세기 화면 →
        </Link>
      </div>

      {/* ---- ① 핵심 숫자 ---- */}
      <section className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="타이어 재고" value={`${kpi.total}본`} sub={`${kpi.products}개 모델`} />
        <Tile label="정가 기준 평가액" value={`${fmtShort(Number(kpi.list_sum))}원`} sub="매입가 기록이 쌓이면 원가 기준 추가" />
        <Tile label="짝 안 맞는 모델" value={`${odd.length}개`} sub={`홀수로 남은 ${oddQty}본`} warn={odd.length > 0} />
        <Tile label="DOT 미입력" value={`${kpi.nodot}본`} sub="창고 세기 화면에서 채우기" warn={kpi.nodot > 0} />
      </section>

      {/* PC 에서 섹션 2열 — 홀수·안 나가는 재고는 전체 폭 (사장님 승인 2026-08-08) */}
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {/* ---- ② 홀수 재고 — 이 리포트의 주인공 ---- */}
      <Section
        wide
        title={`짝이 안 맞는 타이어 ${odd.length}모델`}
        sub="타이어는 2·4본씩 나갑니다 — 1본을 채워 주문하거나, 홀수 것부터 파세요"
      >
        {odd.length ? (
          <ul className="grid grid-cols-1 gap-1 lg:grid-cols-2">
            {odd.map((r, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {r.spec && <strong className="tabular mr-1.5">{r.spec}</strong>}
                  {r.name}
                </span>
                <span className="tabular shrink-0 font-bold text-amber-800">{r.qty}본</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">모두 짝수입니다 👍</p>
        )}
      </Section>

      {/* ---- ③ 연식 (DOT) ---- */}
      <Section title="연식 (DOT)" sub={`오래된 것부터 파세요 · DOT 미입력 ${kpi.nodot}본은 여기 빠져 있습니다`}>
        {yearBars.length ? <ColumnChart data={yearBars} height={160} /> : <p className="text-sm text-slate-400">DOT 기록이 없습니다</p>}
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
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
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
        <BarList rows={brands.map((b) => ({ label: b.bn, qty: b.n }))} max={brandMax} unit="본" />
      </Section>

      {/* ---- ⑥ 규격별 톱10 ---- */}
      <Section title="많이 쌓인 규격 톱10" sub="주문 전에 이미 많은 규격인지 확인">
        <BarList rows={specs.map((r) => ({ label: r.spec, qty: r.n }))} max={specMax} unit="본" />
      </Section>

      {/* ---- ⑦ 안 나가는 재고 ---- */}
      <Section wide title="안 나가는 재고" sub="재고는 있는데 최근 6개월 판매가 없는 모델 — 처분·행사 후보">
        {notSelling.length ? (
          <ul className="grid grid-cols-1 gap-1 lg:grid-cols-2">
            {notSelling.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
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

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warn ? "text-amber-800" : ""}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

/**
 * 🔴 막대를 글자 **뒤에 깔지 않는다** (사장님 제보 2026-08-07 — "그래프가 글씨를 가려서 안보임").
 *    겹치면 폰 브라우저의 다크 모드 강제 변환에서 글자색만 뒤집혀 막대에 묻힌다.
 *    글자 줄 따로, 그 아래 가는 막대 따로 — 어떤 화면에서도 안 겹친다.
 */
function BarList({ rows, max, unit }: { rows: { label: string; qty: number }[]; max: number; unit: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">없습니다</p>;
  return (
    <ol className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="tabular shrink-0 font-semibold">
              {r.qty}
              {unit}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-[#2a78d6]"
              style={{ width: `${max > 0 ? Math.max(2, Math.round((r.qty / max) * 100)) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
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
  /** PC 2열 배치에서 전체 폭을 쓰는 섹션 (긴 목록용) */
  wide?: boolean;
  children: React.ReactNode;
}) {
  // 간격은 부모 grid 의 gap 이 준다 — PC 2열·폰 1열 모두에서 맞는다 (2026-08-08)
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
