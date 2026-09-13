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
  /* 🔴 「마지막 자료 날짜」가 아니라 「어디까지 확인했나」다 (사장님 제보 2026-08-31) —
     월말까지 받았는데 후반 거래가 없으면 자료 날짜만으로는 「안 올라옴」으로 억울하게 찍힌다.
     업로드가 기록한 받은 범위(fin_upload.period_to — 조회기간·받은 날짜 보정 포함)와 max 로 합친다. */
  const bank = await db.execute<{ l: string; d: string | null }>(sql`
    SELECT a.l, GREATEST(a.dmax, COALESCE(b.pmax, a.dmax))::text d FROM
      (SELECT account_label l, max((occurred_at AT TIME ZONE 'Asia/Seoul')::date) dmax
       FROM cash_txn WHERE source = '통장' AND is_active GROUP BY 1) a
      LEFT JOIN (SELECT account_label l, max(period_to) pmax FROM fin_upload
                 WHERE source = '통장' AND status = '반영' GROUP BY 1) b ON b.l = a.l
    ORDER BY 1 LIMIT 10
  `);
  for (const r of bank) rows.push({ key: `bank:${r.l}`, label: `통장 ${r.l}`, last: r.d, granularity: "day", next: "/finance/deposits" });
  const card = await db.execute<{ l: string; d: string | null }>(sql`
    SELECT a.l, GREATEST(a.dmax, COALESCE(b.pmax, a.dmax))::text d FROM
      (SELECT account_label l, max((occurred_at AT TIME ZONE 'Asia/Seoul')::date) dmax
       FROM cash_txn WHERE source = '법인카드' AND is_active GROUP BY 1) a
      LEFT JOIN (SELECT account_label l, max(period_to) pmax FROM fin_upload
                 WHERE source = '법인카드' AND status = '반영' GROUP BY 1) b ON b.l = a.l
    ORDER BY 1 LIMIT 10
  `);
  for (const r of card) rows.push({ key: `card:${r.l}`, label: `법인카드 ${r.l}`, last: r.d, granularity: "day", next: "/finance/expenses" });
  const [posLast] = await db.execute<{ d: string | null }>(sql`SELECT max(day)::text d FROM pos_txn WHERE is_active`);
  rows.push({ key: "pos", label: "토스 포스 매출리포트(일)", last: posLast?.d ?? null, granularity: "day", next: "/finance/card" });
  const [assoc] = await db.execute<{ d: string | null }>(sql`SELECT max(day)::text d FROM card_day WHERE is_active`);
  rows.push({ key: "assoc", label: "여신협회 카드매출(일별)", last: assoc?.d ?? null, granularity: "day", next: "/finance/card" });
  const [dep] = await db.execute<{ m: string | null }>(sql`SELECT max(month) m FROM card_deposit WHERE is_active`);
  rows.push({ key: "deposit", label: "카드사 정산(월)", last: dep?.m ?? null, granularity: "month", next: "/finance/card" });
  /* 홈택스도 같은 이치 (사장님 제보 2026-08-31 2차) — 마지막 계산서 작성일로 잡으면
     오늘까지 조회해 받아도 「안 올라옴」으로 찍힌다. 파일에는 조회기간이 없어서(실측)
     **올린 날**을 「여기까지 확인함」으로 쓴다 — 오늘 받은 파일에는 오늘까지 발급된
     계산서가 다 들어 있다. (⚠ 지난달 분은 다음 달 10일까지 늦게 발급될 수 있다 —
     그래서 다음 달에 한 번 더 받는 습관은 그대로 필요하다) */
  const tax = await db.execute<{ direction: string; d: string | null }>(sql`
    SELECT t.direction, GREATEST(t.dmax, COALESCE(u.umax, t.dmax))::text d FROM
      (SELECT direction, max(write_date) dmax FROM tax_invoice WHERE is_active GROUP BY 1) t
      LEFT JOIN (SELECT CASE source WHEN '홈택스매입' THEN '매입' ELSE '매출' END dir,
                        max((created_at AT TIME ZONE 'Asia/Seoul')::date) umax
                 FROM fin_upload WHERE source IN ('홈택스매입', '홈택스매출') AND status = '반영'
                 GROUP BY 1) u ON u.dir = t.direction
    ORDER BY 1 LIMIT 2
  `);
  for (const dir of ["매입", "매출"]) {
    const r = tax.find((t) => t.direction === dir);
    rows.push({
      key: `tax:${dir}`,
      label: `홈택스 ${dir} 계산서`,
      last: r?.d ?? null,
      granularity: "day",
      next: `/finance/tax?direction=${dir}`,
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
  /* 🔴 월 단위 원천(카드사 정산)은 그 달이 끝나야 자료가 **세상에 나온다** —
     8월이 진행 중일 때 「~07 ⚠」로 재촉하는 것은 잘못이다 (사장님 질문 2026-08-31).
     이 달을 보는 동안은 지난달까지 있으면 정상, 달이 지나면 그 달분을 요구한다. */
  const prevYm = new Date(new Date(ym + "-01T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 7);
  const monthWant = ym === today.slice(0, 7) ? prevYm : ym;
  const lagging = rows.filter((r) => {
    if (!r.last) return true;
    return r.granularity === "month" ? r.last < monthWant : r.last < threshold;
  });
  const lagSet = new Set(lagging.map((r) => r.key));
  const text = rows
    .map((r) => {
      const short = r.label.replace("법인카드 ", "").replace("여신협회 카드매출(일별)", "여신").replace("토스 포스 매출리포트(일)", "포스").replace("카드사 정산(월)", "정산").replace("홈택스 ", "").replace(" 계산서", "");
      const d = r.last ? (r.granularity === "month" ? r.last.slice(2) : r.last.slice(5)) : "없음";
      return `${short} ~${d}${lagSet.has(r.key) ? " ⚠" : ""}`;
    })
    .join(" · ");
  return { lagging, ok: lagging.length === 0, text, endShown };
}
