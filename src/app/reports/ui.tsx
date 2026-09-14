/**
 * ⭐ 리포트 공용 부품 (2026-09-03 — 매출 리포트 토스풍 리프레시에서 승격)
 *
 *   사장님: "토스나 notion 같이 세련되고 트렌디한 ux ui — 정보는 명확,
 *   시각적 군더더기 최소, 그래픽은 적재적소". 네 리포트(매출·재고·마진·MARS)가
 *   같은 부품을 쓴다 — 스타일이 갈라지면 여기 한 곳만 고친다.
 *
 * 🔴 순위 막대는 글자 뒤에 깔지 않는다 (사장님 제보 2026-08-07) — 글자 줄
 *    아래 얇은 막대. 이 규칙을 BarList 부품 안에 봉인한다.
 */
import Link from "@/lib/link";
import { fmtShort } from "./charts";

/** 섹션 카드 — 제목 작고 진하게 + 연회색 설명 한 줄 */
export function Section({
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
  return (
    <section className={`rounded-card border border-slate-200 bg-white p-4 shadow-card ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 보조 숫자 한 칸 — 보더 없이 여백으로 구분 */
export function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="tabular mt-0.5 font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-tight text-slate-400">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block active:opacity-70">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

/** 증감 칩 — 상승은 브랜드 그린, 하락은 조용한 회색 (매출 하락은 사고가 아니라 정보) */
export function DeltaChip({ v, label }: { v: number; label: string }) {
  const up = v >= 0;
  return (
    <span
      className={`tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(v)}%<span className="font-normal opacity-70">{label}</span>
    </span>
  );
}

export interface RankRow {
  key: string;
  label: string;
  /** 오른쪽 끝 값 (진하게) */
  value: string;
  /** 값 앞 보조 표기 — "12건 · " */
  note?: string;
  /** 막대 폭의 기준값 (첫 행 대비) */
  weight: number;
  href?: string;
}

/** 순위 목록 — 글자 줄 + 아래 얇은 막대 (1위 대비 폭). 행 전체가 탭 타깃 */
export function BarList({ rows, color = "#009944" }: { rows: RankRow[]; color?: string }) {
  const max = rows.length ? Math.max(...rows.map((r) => r.weight)) : 0;
  return (
    <ol className="space-y-2">
      {rows.map((r) => {
        const w = max > 0 ? Math.max(2, Math.round((r.weight / max) * 100)) : 0;
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {r.note}
                <strong className="text-slate-900">{r.value}</strong>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full" style={{ width: `${w}%`, backgroundColor: color }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block active:opacity-70">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 리포트 탭 바 (2026-09-14 — 네 화면에 복붙돼 있던 것을 한 곳으로, 손님·차량 추가).
 * 탭이 6개라 폰 폭에서는 옆으로 밀어 본다.
 */
const REPORT_TABS = [
  { key: "sales", label: "매출", href: "/reports" },
  { key: "stock", label: "재고", href: "/reports/stock" },
  { key: "margin", label: "마진", href: "/reports/margin" },
  { key: "mars", label: "MARS", href: "/reports/mars" },
  { key: "customers", label: "손님", href: "/reports/customers" },
  { key: "vehicles", label: "차량", href: "/reports/vehicles" },
] as const;

export type ReportTabKey = (typeof REPORT_TABS)[number]["key"];

export function ReportTabs({ active, className = "" }: { active: ReportTabKey; className?: string }) {
  return (
    <nav className={`-mx-1 flex gap-1 overflow-x-auto whitespace-nowrap px-1 ${className}`}>
      {REPORT_TABS.map((t) =>
        t.key === active ? (
          <span key={t.key} className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            {t.label}
          </span>
        ) : (
          <Link
            key={t.key}
            href={t.href}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-100"
          >
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}

/** [개인 · 거래처 · 전체] 단추 — 링크로 바꾼다 (달은 그대로 들고 간다) */
export function WhoToggle({
  who,
  href,
}: {
  who: "person" | "biz" | "all";
  /** 단추별 주소 만들기 */
  href: (who: "person" | "biz" | "all") => string;
}) {
  const opts = [
    { key: "person", label: "개인" },
    { key: "biz", label: "거래처" },
    { key: "all", label: "전체" },
  ] as const;
  return (
    <div className="inline-flex rounded-control bg-slate-100 p-1">
      {opts.map((o) =>
        o.key === who ? (
          <span key={o.key} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-slate-900 shadow-sm">
            {o.label}
          </span>
        ) : (
          <Link key={o.key} href={href(o.key)} className="rounded-lg px-4 py-1.5 text-sm font-medium text-slate-500 active:bg-slate-200">
            {o.label}
          </Link>
        ),
      )}
    </div>
  );
}

export { fmtShort };
