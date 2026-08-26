/**
 * ⭐ 「어디까지 올렸나」 정본 (2026 감사 R3, 2026-08-26)
 *
 *   원천별(통장 계좌·법인카드·여신협회·카드사 정산·홈택스 매입/매출) 마지막 자료 날짜.
 *   올리기 화면 맨 위·현황 마감 체크리스트·카드 화면 컷오프 배너가 같은 표를 쓴다.
 *   전엔 현황 11px 한 줄(카드는 라벨 통합 max)뿐이라 우리카드 24일 공백·정산 자료 누락을
 *   사장님이 알 수 없었다.
 *
 * 🔴 "use server" 아님. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kstToday, monthRange } from "./ym";

export interface CoverageRow {
  key: string;
  /** 화면 이름 — "통장 신한입금" · "법인카드 우리법인카드" · "여신협회 카드매출" · "카드사 정산" · "홈택스 매입" */
  label: string;
  /** 마지막 자료 날짜 (YYYY-MM-DD) — 월 단위 원천은 YYYY-MM. 없으면 null */
  last: string | null;
  granularity: "day" | "month";
  /** 이 원천을 올리면 다음에 볼 화면 */
  next: string;
}

export async function uploadCoverage(): Promise<CoverageRow[]> {
  const rows: CoverageRow[] = [];
  const bank = await db.execute<{ l: string; d: string | null }>(sql`
    SELECT account_label l, max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text d
    FROM cash_txn WHERE source = '통장' AND is_active GROUP BY 1 ORDER BY 1 LIMIT 10
  `);
  for (const r of bank) rows.push({ key: `bank:${r.l}`, label: `통장 ${r.l}`, last: r.d, granularity: "day", next: "/finance/deposits" });
  const card = await db.execute<{ l: string; d: string | null }>(sql`
    SELECT account_label l, max((occurred_at AT TIME ZONE 'Asia/Seoul')::date)::text d
    FROM cash_txn WHERE source = '법인카드' AND is_active GROUP BY 1 ORDER BY 1 LIMIT 10
  `);
  for (const r of card) rows.push({ key: `card:${r.l}`, label: `법인카드 ${r.l}`, last: r.d, granularity: "day", next: "/finance/expenses" });
  const [assoc] = await db.execute<{ d: string | null }>(sql`SELECT max(day)::text d FROM card_day WHERE is_active`);
  rows.push({ key: "assoc", label: "여신협회 카드매출(일별)", last: assoc?.d ?? null, granularity: "day", next: "/finance/card" });
  const [dep] = await db.execute<{ m: string | null }>(sql`SELECT max(month) m FROM card_deposit WHERE is_active`);
  rows.push({ key: "deposit", label: "카드사 정산(월)", last: dep?.m ?? null, granularity: "month", next: "/finance/card" });
  const tax = await db.execute<{ direction: string; d: string | null }>(sql`
    SELECT direction, max(write_date)::text d FROM tax_invoice WHERE is_active GROUP BY 1 ORDER BY 1 LIMIT 2
  `);
  for (const dir of ["매입", "매출"]) {
    const r = tax.find((t) => t.direction === dir);
    rows.push({
      key: `tax:${dir}`,
      label: `홈택스 ${dir} 계산서`,
      last: r?.d ?? null,
      granularity: "day",
      next: `/finance/tax?view=money&direction=${dir}`,
    });
  }
  return rows;
}

export interface CoverageStatus {
  /** 이 달 끝(또는 오늘)에 못 미치는 원천 */
  lagging: CoverageRow[];
  ok: boolean;
  /** "통장 신한입금 ~08-24 · 법인카드 우리 ~07-31 ⚠ · …" */
  text: string;
  /** 비교 기준일 (이 달이면 오늘, 지난 달이면 말일) */
  endShown: string;
}

/** 이 달 기준으로 원천별 상태 — 기준일 3일 전까지 안 오면 ⚠ (은행 자료는 하루이틀 늦게 올린다) */
export function coverageStatus(rows: CoverageRow[], ym: string): CoverageStatus {
  const { nextStart } = monthRange(ym);
  const today = kstToday();
  const lastDay = new Date(new Date(nextStart + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const endShown = ym === today.slice(0, 7) ? today : lastDay;
  const threshold = new Date(new Date(endShown + "T00:00:00Z").getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const lagging = rows.filter((r) => {
    if (!r.last) return true;
    return r.granularity === "month" ? r.last < ym : r.last < threshold;
  });
  const lagSet = new Set(lagging.map((r) => r.key));
  const text = rows
    .map((r) => {
      const short = r.label.replace("법인카드 ", "").replace("여신협회 카드매출(일별)", "여신").replace("카드사 정산(월)", "정산").replace("홈택스 ", "").replace(" 계산서", "");
      const d = r.last ? (r.granularity === "month" ? r.last.slice(2) : r.last.slice(5)) : "없음";
      return `${short} ~${d}${lagSet.has(r.key) ? " ⚠" : ""}`;
    })
    .join(" · ");
  return { lagging, ok: lagging.length === 0, text, endShown };
}
