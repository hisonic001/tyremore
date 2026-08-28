/**
 * ⭐ 세금계산서 대조 v2 — 후보 계산 (사장님 승인 2026-08-25 리빌딩)
 *
 *   v1 의 문제(실측): ①미대조의 98%가 앱 도입 전 과거분 ②매출 상대가 대부분
 *   보험·렌터카 「대행 정산사」(카랑·레드캡투어…)인데 거래처 판매만 뒤짐
 *   ③경비성 매입(세무법인·네이버…)이 계속 화면에 남음.
 *
 *   v2 원칙:
 *   - 대조 대상 = 자료 전 기간(2025-01~). 🔴 2026-08-26: 「과거분 접기」 폐지 — 사장님 방침
 *     "중요한 건 자료". 2025년은 앱 기록이 없으므로 통장 직접 잇기·월정산 잔액이 길이다.
 *   - 계산서 나열이 아니라 **상대(사업자번호) 단위 그룹** — 한 번 유형을 정하면 계속 자동.
 *   - 매출 매칭 풀 = 모든 판매(거래처·고객·비회원, 결제수단 무관) + **통장 입금 직접 연결**
 *     (대행사는 「월합계 계산서 = 이 입금」이 실질이다).
 *
 * 🔴 "use server" 아님 — 화면이 권한 확인 후 부르고, 쓰기는 recon.ts.
 * 🔴 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { payerKeyOf } from "./expense-cats";
import { cashUsedMap, normName, partyMonthlyCash, partyStrictNames, samePartyName, similarPartyName } from "./recon-data";
import { monthRange } from "./ym";

export interface TaxRow {
  id: number;
  direction: "매출" | "매입";
  approvalNo: string;
  writeDate: string;
  counterBizNo: string;
  counterName: string;
  supplyAmount: number;
  vat: number;
  total: number;
  itemSummary: string | null;
  reconStatus: string;
  reconReason: string | null;
}

export interface CandidateRef {
  table: "purchase_invoice" | "quote";
  id: number;
  label: string;
  date: string | null;
  amount: number;
}

/** 통장 입금 후보 — 매출 계산서를 입금과 직접 잇는다 (대행 정산사) */
export interface BankRef {
  id: number;
  label: string;
  amount: number;
  date: string;
  /** ★ 기억됐거나 이름이 닮은 상대 — false 면 금액만 같은 줄 (확인 필요) */
  known: boolean;
}

export interface TaxSuggestion {
  inv: TaxRow;
  auto: CandidateRef | null;
  bundle: CandidateRef[] | null;
  candidates: CandidateRef[];
  bankCands: BankRef[];
  /** 여러 통장 줄의 합이 계산서와 맞는(허용 오차 안) 조합 — 한꺼번에 잇는다. diff = 합 − 계산서 */
  bankCombo: { ids: number[]; labels: string[]; total: number; diff: number } | null;
  /** 마이너스(수정) 계산서의 원본으로 보이는 짝들 — 같은 금액 원본이 여럿이면 다 보여준다 (2025 감사 F4) */
  fixPairs: { id: number; label: string }[];
  /** 이 계산서가 어떤 마이너스 계산서의 원본 후보다 — 통장보다 상쇄가 먼저 (2026 감사 G9) */
  fixOrigin: boolean;
  supplierId: number | null;
  supplierName: string | null;
  learnable: boolean;
}

/** ⭐ 통장 한 줄 = 이 상대 계산서 여러 장 합 (사장님 케이스 2026-08-26 — 타이어프로 속초점
 *  +842,160 = 242,160 + 600,000). 한 번에 잇는다. */
export interface BankBundle {
  cashId: number;
  label: string;
  total: number;
  invoiceIds: number[];
  parts: string[];
}

export interface PartyGroup {
  bizNo: string;
  name: string;
  /** tax_party_rule 의 유형 — null 이면 미지정 */
  kind: string | null;
  count: number;
  sum: number;
  items: TaxSuggestion[];
  /** 입금·출금 한 줄이 이 상대 계산서 N장(≥2) 합과 정확히 맞으면 — 그룹 머리에 한꺼번에 잇기 */
  bankBundle: BankBundle | null;
}

/** 통장 줄들 중 계산서 부분집합(≥2장) 합과 정확히 맞는 첫 줄 — 정리 뷰·돈 확인 뷰가 같이 쓴다 */
export function findBankBundle(
  invoices: { id: number; total: number; label: string }[],
  lines: { id: number; amount: number; label: string }[],
): BankBundle | null {
  const cands = invoices.filter((i) => i.total > 0);
  if (cands.length < 2) return null;
  const seen = new Set<number>();
  for (const line of lines) {
    if (seen.has(line.id) || line.amount <= 0) continue;
    seen.add(line.id);
    if (cands.some((c) => c.total === line.amount)) continue; // 한 장과 정확히 맞으면 그 장의 일반 후보
    const combo = findAmountCombo(cands.map((c) => ({ id: c.id, amount: c.total, label: c.label })), line.amount);
    if (combo) {
      return {
        cashId: line.id,
        label: line.label,
        total: line.amount,
        invoiceIds: combo.map((c) => c.id),
        parts: combo.map((c) => c.label),
      };
    }
  }
  return null;
}

export interface TaxReconV2 {
  groups: PartyGroup[];
  openCount: number;
  autoCount: number;
  doneCount: number;
  ignoredCount: number;
  reasonCounts: { reason: string; n: number }[];
  supplierOptions: { id: number; name: string }[];
  /** 이 달 창의 앱 기록 건수 — 0이면(2025) 「통장에서 직접 찾기」 안내 (매입은 인보이스, 매출은 판매) */
  appPurchasesN: number;
  appQuotesN: number;
}

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 통장 줄 라벨 정본 (2025 감사 F3, 2026-08-26)
 *   - 날짜는 연도 포함 `YY-MM-DD` — 20개월 자료에서 「01-30」이 2025인지 2026인지 알 수 없었다.
 *   - 부호(+입금/−출금)는 금액 컬럼에서 — 시트명(account_label)은 방향이 아니다
 *     (「신한출금」 시트에 입금 449줄). 시트명은 라벨에서 뺀다.
 *   - 이름 근거 없이 금액만 같은 줄은 「이름 다름 — 확인 필요」를 붙인다 (F15).
 */
export function bankLabel(
  x: { date: string; description: string; remain: number },
  isIn: boolean,
  known: boolean,
  target?: number,
  /** ≈ 등급 — 앞부분이 같거나 적요 조각이 상호와 맞는 상대 (2026 감사 G8·R9) */
  similar = false,
): string {
  const diff =
    target === undefined || x.remain === target
      ? ""
      : ` · 계산서보다 ${won(Math.abs(x.remain - target))}원 ${x.remain > target ? "많음" : "적음"}`;
  /* 🔴 2025 진행(2026-08-27): 이체 수수료 500원이 붙은 금액도 「이름 다름 — 확인」으로 (진양윤활유 3,696,000 ↔ 김재준 3,696,500) */
  const warn = known
    ? ""
    : similar
      ? " · 비슷한 이름 — 확인"
      : target !== undefined && Math.abs(x.remain - target) <= nearTolerance(target)
        ? " · 이름 다름 — 확인 필요"
        : "";
  return `${known ? "★ " : similar ? "≈ " : ""}${x.date.slice(2)} · ${x.description.slice(0, 24)} · ${isIn ? "+" : "−"}${won(x.remain)}원${diff}${warn}`;
}
const comboLabel = (c: { date: string; desc: string; amount: number }, isIn: boolean) =>
  `${c.date.slice(2)} · ${c.desc.slice(0, 20)} · ${isIn ? "+" : "−"}${won(c.amount)}원`;

/**
 * ⭐ 출금·입금 조합 찾기 (사장님 제보 2026-08-25 — 위즈오토 7월 계산서 1,531,222원이
 *    7/8 840,092 + 7/8 500,940 + 7/12 190,190 세 건의 합과 정확히 같았다).
 *
 *    월합계 계산서를 쓰는 곳은 결제를 건별로 나눠 하므로, 한 건씩 골라 잇는 대신
 *    **합이 딱 맞는 조합**을 찾아 한꺼번에 이어 준다.
 *
 * 🔴 사장님 요청(2026-08-26, 유일이엔티): 198,860 + 2,323,200 = 2,522,060 이 계산서 2,521,860 과
 *    200원 어긋나 조합이 안 떴다 — 이체 수수료·반올림 몫. **허용 오차**(1,000원 또는 0.1% 중 큰 쪽)
 *    안이면 조합으로 제안하고 차이를 정직하게 적는다. 정확 일치가 있으면 그것을 우선.
 *    폭도 넓힌다: 최대 6줄 · 후보 20개 (부분집합 탐색 ≈ 6만 회, 즉시).
 */
export const nearTolerance = (target: number): number => Math.max(1000, Math.round(Math.abs(target) * 0.001));

export function findAmountComboNear<T extends { id: number; amount: number }>(
  cands: T[],
  target: number,
  tol: number,
  maxPick = 6,
): { picks: T[]; sum: number } | null {
  if (target <= 0 || cands.length < 2) return null;
  // 후보가 많으면 앞쪽(호출자가 관련도 순으로 정렬해 옴) 20개만 탐색 (감사 C3 계보)
  const pool = cands.filter((c) => c.amount > 0 && c.amount <= target + tol).slice(0, 20);
  if (pool.length < 2) return null;
  pool.sort((a, b) => b.amount - a.amount); // 건수가 적은 조합을 먼저 찾도록 큰 금액부터
  const st = { best: null as T[] | null, diff: Number.POSITIVE_INFINITY };
  const pick: T[] = [];
  const dfs = (i: number, sum: number) => {
    if (st.best && st.diff === 0) return; // 정확 일치면 충분
    if (pick.length >= 2) {
      const dd = Math.abs(sum - target);
      if (dd <= tol && dd < st.diff) {
        st.best = [...pick];
        st.diff = dd;
      }
    }
    if (i >= pool.length || pick.length >= maxPick || sum > target + tol) return;
    for (let j = i; j < pool.length; j++) {
      if (sum + pool[j].amount > target + tol) continue;
      pick.push(pool[j]);
      dfs(j + 1, sum + pool[j].amount);
      pick.pop();
      if (st.best && st.diff === 0) return;
    }
  };
  dfs(0, 0);
  const best = st.best;
  return best ? { picks: best, sum: best.reduce((a, c) => a + c.amount, 0) } : null;
}

/** 정확히 맞는 조합만 (묶음 잇기 등) */
export function findAmountCombo<T extends { id: number; amount: number }>(
  cands: T[],
  target: number,
  maxPick = 6,
): T[] | null {
  return findAmountComboNear(cands, target, 0, maxPick)?.picks ?? null;
}
/**
 * ⭐ 날짜순 연속 묶음 (2025 진행 2026-08-27 — 양양현대자동차 6/30 계산서 4,908,000원 = 3/24~6/25 입금 11줄).
 *    월·분기 합계 계산서는 같은 상대의 결제가 **시간순으로 쭉** 쌓인 것이라, 부분집합 탐색(6줄 한도) 대신
 *    날짜순 연속 구간의 합이 맞는지 본다. ★ 상대만 넣는다(호출자 책임). 정확 일치 우선.
 */
export function findAmountRun<T extends { id: number; amount: number; date: string }>(
  cands: T[],
  target: number,
  tol: number,
  maxLen = 15,
): { picks: T[]; sum: number } | null {
  if (target <= 0 || cands.length < 2) return null;
  const pool = cands
    .filter((c) => c.amount > 0 && c.amount <= target + tol)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let best: { picks: T[]; sum: number } | null = null;
  for (let i = 0; i < pool.length; i++) {
    let sum = 0;
    for (let j = i; j < pool.length && j - i < maxLen; j++) {
      sum += pool[j].amount;
      if (sum > target + tol) break;
      if (j - i >= 1 && Math.abs(sum - target) <= tol) {
        if (!best || Math.abs(sum - target) < Math.abs(best.sum - target)) best = { picks: pool.slice(i, j + 1), sum };
        if (sum === target) return best;
      }
    }
  }
  return best;
}
/** 부분집합 조합이 정확하면 그것, 아니면 연속 묶음, 그도 없으면 근사 조합 */
const bestCombo = <T extends { id: number; amount: number; date: string }>(src: T[], target: number) => {
  const tol = nearTolerance(target);
  const c = findAmountComboNear(src, target, tol);
  if (c && c.sum === target) return c;
  return findAmountRun(src, target, tol) ?? c;
};
const sameMonth = (a: string | null, b: string) => !!a && a.slice(0, 7) === b.slice(0, 7);
const dayDiff = (a: string | null, b: string): number =>
  a ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 999;

export async function taxReconV2(ym: string): Promise<TaxReconV2> {
  /* 월별 보기 (사장님 지적 2026-08-25) — 항상 그 달만. 🔴 2025 감사 F12: ym 없는 기본값
     (2026-08 이후)은 2025를 통째로 빼는 함정이라 폐지 — ym 필수 */
  const mr = monthRange(ym);
  const invWhere = sql`write_date >= ${mr.start}::date AND write_date < ${mr.nextStart}::date`;
  // ① 열린 계산서 — 이 달
  const invs = await db.execute<{
    id: number; direction: "매출" | "매입"; approval_no: string; write_date: string;
    counterparty_biz_no: string; counterparty_name: string;
    supply_amount: number; vat: number; total: number; item_summary: string | null;
    recon_status: string; recon_reason: string | null;
  }>(sql`
    SELECT id, direction, approval_no, to_char(write_date, 'YYYY-MM-DD') write_date,
           counterparty_biz_no, counterparty_name, supply_amount, vat, total, item_summary,
           recon_status, recon_reason
    FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조', '제안') AND ${invWhere}
    ORDER BY write_date DESC, id DESC LIMIT 150
  `);
  // 🔴 재설계 C3: 카운트는 절단 없는 count(*) — 150건 넘으면 화면이 "더 있음"을 안다
  const [openCnt] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조', '제안') AND ${invWhere}
  `);

  // ② 상태·사유 집계 — 🔴 2025 감사 F13: 전체 DB 값이 아니라 보는 달 (2025-01 화면에
  //    2026-08 「확정 36건」이 찍히던 문제)
  const counts = await db.execute<{ s: string; n: number }>(sql`
    SELECT recon_status s, count(*)::int n FROM tax_invoice WHERE is_active AND ${invWhere} GROUP BY 1 LIMIT 5
  `);
  const reasons = await db.execute<{ reason: string; n: number }>(sql`
    SELECT COALESCE(recon_reason, '직접') reason, count(*)::int n FROM tax_invoice
    WHERE is_active AND recon_status = '무시' AND ${invWhere} GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `);

  // ③ 거래처·별명·상대 유형 사전
  const suppliers = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 500
  `);
  const aliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias
    -- 🔴 LIMIT 없음 (2026-08-28): 별명은 「이을 때마다 한 줄씩 늘어나는」 표다. 잘려도
    --    오류가 안 나고 ★(기억된 상대)만 조용히 꺼져 후보·자동잇기가 틀리기 시작한다.
  `);
  const aliasMap = new Map(aliases.map((a) => [a.alias_key, a.party_key]));
  const rules = await db.execute<{ biz_no: string; kind: string }>(sql`
    SELECT biz_no, kind FROM tax_party_rule LIMIT 1000
  `);
  const ruleMap = new Map(rules.map((r) => [r.biz_no, r.kind]));

  // ④ 매입 인보이스 (앱 매입 기록)
  const purchases = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number | null;
  }>(sql`
    SELECT id, supplier, invoice_no,
           COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d, total
    FROM purchase_invoice WHERE status <> '취소'
      -- 🔴 재설계 C3: 최신순 컷 → quotes(감사 M6)와 같은 날짜창. 2025 감사 F14: 보는 달 ±창
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
          >= to_char(${mr.start}::date - 75, 'YYYY-MM-DD')
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
          < to_char(${mr.nextStart}::date + 75, 'YYYY-MM-DD')
    ORDER BY id DESC LIMIT 1000
  `);

  // ⑤ 판매 — 거래처·고객·비회원 가리지 않고, 결제수단 무관 (v2 확장)
  const quotes = await db.execute<{
    id: number; quote_no: string; total: number; d: string; who: string | null; pm: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           COALESCE(q.supplier_name, c.name) who, q.payment_method pm
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.total_amount > 0
      -- 🔴 감사 M6: 최신순 컷이 아니라 날짜창 — 보는 달 ±창 (2025 감사 F14)
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${mr.start}::date - 75
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${mr.nextStart}::date + 75
    ORDER BY q.id DESC LIMIT 1000
  `);

  // ⑥ 이미 이어진 기록 제외 — 🔴 2026 감사 N8: 전체 LIMIT 10000 대신 이 풀의 id 만 조회(절단 없음)
  const poolIds = [...purchases.map((p) => Number(p.id)), ...quotes.map((q) => Number(q.id))];
  const linked =
    poolIds.length === 0
      ? []
      : await db.execute<{ ref_table: string; ref_id: number }>(sql`
          SELECT ref_table, ref_id FROM recon_match
          WHERE kind IN ('매입계산서', '매출계산서') AND ref_table IN ('purchase_invoice', 'quote')
            AND ref_id IN (${sql.join(poolIds.map((i) => sql`${i}`), sql`, `)})
          LIMIT 5000
        `);
  const linkedSet = new Set(linked.map((l) => `${l.ref_table}|${l.ref_id}`));
  /* 🔴 재설계 C1(2026-08-25): 통장 줄 남은 금액은 소진량 정본(cashUsedMap)으로 —
     지급 잡기('매입지급')·외상 수금('이체입금')이 쓴 몫까지 센다. 이중계상 차단 */
  const cashLinked = await cashUsedMap();
  const freePurchases = purchases.filter((p) => Number(p.total) > 0 && !linkedSet.has(`purchase_invoice|${p.id}`));
  const freeQuotes = quotes.filter((q) => !linkedSet.has(`quote|${q.id}`));

  // ⑦ 통장 입금 후보 (매출 계산서 ↔ 입금 직접 연결)
  const deposits = await db.execute<{ id: number; date: string; description: string; in_amount: number; l: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           description, in_amount, account_label l
    FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0 AND category IS NULL
      AND recon_status <> '확정' -- 🔴 감사 H7: 외상 수금 등으로 이미 정리된 입금은 후보에서 뺀다
      -- 🔴 2025 감사 F10: 상한 없이 id DESC 800 이면 2025 달의 풀이 2026 줄로 채워진다(id 는 시간순도 아님)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${mr.start}::date - 120 -- ★ 뒤창 120일(분기 합계 계산서, 2025 진행 2026-08-27)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${mr.nextStart}::date + 150
    ORDER BY occurred_at DESC LIMIT 800
  `);
  const freeDeposits = deposits
    .map((x) => ({ ...x, remain: Number(x.in_amount) - (cashLinked.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);

  /* ⑦-2 통장 출금 후보 (매입 계산서 ↔ 출금 직접 연결) — 사장님 통찰 2026-08-25:
   *   "앱 내역과 대조하는 것보다 입출금 내역에서 대조하는 것이 더 정확함" */
  const withdrawals = await db.execute<{ id: number; date: string; description: string; out_amount: number; l: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           description, out_amount, account_label l
    FROM cash_txn
    WHERE source = '통장' AND is_active AND out_amount > 0
      AND (category IS NULL OR category = '매입대금')
      AND recon_status <> '확정' -- 🔴 재설계 C2: 이미 정리된 출금은 후보에서 뺀다 (deposits와 대칭)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${mr.start}::date - 120 -- ★ 뒤창 120일(분기 합계 계산서, 2025 진행 2026-08-27)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${mr.nextStart}::date + 150
    ORDER BY occurred_at DESC LIMIT 800
  `);
  const freeWithdrawals = withdrawals
    .map((x) => ({ ...x, remain: Number(x.out_amount) - (cashLinked.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);

  const norm = normName;

  /* ⭐ 사장님 지적(2026-08-26, 속초건설): 계산서 1,565,000 카드에 옆 계산서(140,000) 몫인 입금
     +140,000 이 ★ 후보로 떠서, 누르면 엉뚱한 부분 연결이 됐다. 같은 상대·같은 방향의 **다른 열린
     계산서와 금액이 정확히 맞는** 통장 줄은 그 계산서 몫이므로 이 계산서 후보에서 뺀다. */
  const openTotals = new Map<string, number[]>();
  for (const r of invs) {
    const k = `${r.counterparty_biz_no}|${r.direction}`;
    openTotals.set(k, [...(openTotals.get(k) ?? []), Number(r.total)]);
  }
  const siblingAmt = (amt: number, inv: TaxRow) =>
    amt !== inv.total && (openTotals.get(`${inv.counterBizNo}|${inv.direction}`) ?? []).some((t) => t === amt);

  const suggestions: TaxSuggestion[] = [];
  for (const r of invs) {
    const inv: TaxRow = {
      id: Number(r.id),
      direction: r.direction,
      approvalNo: r.approval_no,
      writeDate: r.write_date,
      counterBizNo: r.counterparty_biz_no,
      counterName: r.counterparty_name,
      supplyAmount: Number(r.supply_amount),
      vat: Number(r.vat),
      total: Number(r.total),
      itemSummary: r.item_summary,
      reconStatus: r.recon_status,
      reconReason: r.recon_reason,
    };

    /* ⭐ 월정산 상대는 개별 매칭을 요구하지 않는다 (사장님 지적 2026-08-25 —
       "월정산으로 지정했는데도 계속 하나씩 고르라고 함"). 계산서 1장 ↔ 출금 1건이
       대응하지 않는 곳이므로 후보를 만들지 않고, 화면은 잔액으로 보라고 안내한다. */
    if (ruleMap.get(inv.counterBizNo) === "월정산") {
      suggestions.push({
        inv,
        auto: null,
        bundle: null,
        candidates: [],
        bankCands: [],
        bankCombo: null,
        fixPairs: [],
        fixOrigin: false,
        supplierId: null,
        supplierName: null,
        learnable: false,
      });
      continue;
    }

    if (inv.direction === "매입") {
      const byBiz = suppliers.find((s) => s.biz_no && s.biz_no.replace(/\D/g, "") === inv.counterBizNo);
      const aliasParty = aliasMap.get(norm(inv.counterName)) ?? null;
      const byAlias = aliasParty?.startsWith("S:")
        ? (suppliers.find((s) => s.name === aliasParty.slice(2)) ?? null)
        : null;
      const byName =
        byBiz ?? byAlias ??
        suppliers.find((s) => {
          const a = norm(s.name);
          const b = norm(inv.counterName);
          return a.length >= 2 && (b.includes(a) || a.includes(b));
        }) ?? null;
      const sup = byName;
      const pool = sup
        ? freePurchases.filter((p) => norm(p.supplier) === norm(sup.name) || norm(p.supplier) === norm(inv.counterName))
        : freePurchases.filter((p) => norm(p.supplier) === norm(inv.counterName));
      const toRef = (p: (typeof pool)[number]): CandidateRef => ({
        table: "purchase_invoice",
        id: Number(p.id),
        label: `${p.invoice_no} · ${p.supplier} · ${won(Number(p.total))}원${p.d ? ` (${p.d.slice(5)})` : ""}`,
        date: p.d,
        amount: Number(p.total),
      });
      const exact = pool.filter((p) => Number(p.total) === inv.total && dayDiff(p.d, inv.writeDate) <= 7);
      const auto = (byBiz ?? byAlias) && exact.length === 1 ? toRef(exact[0]) : null;
      const monthPool = pool.filter((p) => sameMonth(p.d, inv.writeDate));
      const monthSum = monthPool.reduce((s, p) => s + Number(p.total), 0);
      const bundle = !auto && monthPool.length > 1 && monthSum === inv.total ? monthPool.map(toRef) : null;
      const near = pool
        .filter(
          (p) =>
            dayDiff(p.d, inv.writeDate) <= 45 ||
            Math.abs(Number(p.total) - inv.total) <= Math.max(1000, Math.abs(inv.total) * 0.01),
        )
        .slice(0, 6)
        .map(toRef);
      /* 통장 출금 직접 연결 후보 — 지급은 계산서보다 늦을 수 있어 +90일(기억된 상대 +150일).
       *   ★ = 기억된 지급처(내 출금 이름이 계산서 상호와 달라도 한 번 이으면 기억) */
      const buyPool = freeWithdrawals
        .map((x) => {
          const payer = payerKeyOf("통장", x.description);
          // ★ = 기억된 지급처. 이름이 닮아도(적요 잘림 견딤) 후보로 올린다 (2026-08-25)
          const known =
            aliasMap.has(`${norm(payer)}@${inv.counterBizNo}`) ||
            samePartyName(payer, inv.counterName) ||
            (!!sup && samePartyName(payer, sup.name));
          const similar = !known && (similarPartyName(payer, inv.counterName) || (!!sup && similarPartyName(payer, sup.name)));
          /* ⭐ 수수료 포함 금액 (2025 진행 2026-08-27): 지급은 거의 늘 「사람 이름」·「산 물건 메모」로 나가고
             BZ뱅크 이체 수수료 500원이 붙어, 이름도 금액도 안 맞아 후보에 아예 안 떴다
             (진양윤활유 3,696,000 ↔ 3/15 김재준 3,696,500 · 일리터 2,802,000 ↔ 7/22 이재협 2,802,500).
             허용 오차(1,000원·0.1%) 안 + ±30일이면 후보로는 올린다 — 자동으로 잇지는 않는다(이름 근거 없음) */
          const nearAmt = x.remain !== inv.total && Math.abs(x.remain - inv.total) <= nearTolerance(inv.total);
          return { x, known, similar, exact: x.remain === inv.total, nearAmt };
        })
        .filter(({ x, known, similar, exact, nearAmt }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          if (nearAmt && !known && !similar) return Math.abs(t - w) <= 30 * 86400000 && !siblingAmt(x.remain, inv);
          /* 🔴 창 넓힘(2026-08-25 위즈오토): 월말 합계 계산서는 그 달 내내의 결제를 담는다 —
             7/31 계산서에 7/8·7/12 출금이 짝인데 -7일 창이라 잘려 조합을 못 찾았다. */
          const inWindow = t >= w - (known ? 120 : 45) * 86400000 && t <= w + (known ? 150 : 90) * 86400000; // ★는 앞 90일 (2025 진행)
          return inWindow && (exact || known || similar) && !siblingAmt(x.remain, inv); // 기억된 지급처는 차액이 있어도 보여준다 (다른 계산서 몫은 제외)
        })
        .sort(
          (a, b) =>
            Number(b.exact) - Number(a.exact) ||
            Number(b.known) - Number(a.known) ||
            Number(b.similar) - Number(a.similar) ||
            Number(b.nearAmt) - Number(a.nearAmt) ||
            // 계산서 날짜에 가까운 것 먼저 (8월 것이 7월 계산서 위로 오던 문제)
            dayDiff(a.x.date, inv.writeDate) - dayDiff(b.x.date, inv.writeDate),
        );
      /* 합이 딱 맞는 조합 — 월합계 계산서 + 건별 결제(위즈오토 케이스) */
      const comboSrc = buyPool
        .filter(({ known }) => known)
        .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description, l: x.l }));
      const combo = buyPool.some(({ exact }) => exact) ? null : bestCombo(comboSrc, inv.total);
      const buyBank = buyPool.slice(0, 4).map(({ x, known, similar }) => ({
        id: Number(x.id),
        label: bankLabel(x, false, known, inv.total, similar),
        amount: x.remain,
        date: x.date,
        known,
      }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : near,
        bankCands: buyBank,
        bankCombo: combo
          ? {
              ids: combo.picks.map((c) => c.id),
              labels: combo.picks.map((c) => comboLabel(c, false)),
              total: combo.sum,
              diff: combo.sum - inv.total,
            }
          : null,
        fixPairs: [],
        fixOrigin: false,
        supplierId: sup ? Number(sup.id) : null,
        supplierName: sup?.name ?? null,
        learnable: !!sup && !sup.biz_no,
      });
    } else {
      // 매출 — 이름이 이어지는 판매(누구든) 우선, 없으면 같은 달 같은 금액(수단 무관)
      const aliasSell = aliasMap.get(norm(inv.counterName)) ?? null;
      const aliasName = aliasSell?.startsWith("S:") ? aliasSell.slice(2) : null;
      const namePool = freeQuotes.filter((q) => {
        if (aliasName && q.who === aliasName) return true;
        const a = norm(q.who);
        const b = norm(inv.counterName);
        return a.length >= 2 && (b.includes(a) || a.includes(b));
      });
      const toRef = (q: (typeof namePool)[number]): CandidateRef => ({
        table: "quote",
        id: Number(q.id),
        label: `${q.quote_no} · ${q.who ?? "손님"} · ${won(Number(q.total))}원 · ${q.pm ?? "?"} (${q.d.slice(5)})`,
        date: q.d,
        amount: Number(q.total),
      });
      const exact = namePool.filter((q) => Number(q.total) === inv.total && sameMonth(q.d, inv.writeDate));
      /* 🔴 감사 H4(2026-08-25): 자동확정은 **기억된 상대(별명)**일 때만 — 부분포함 이름
         매칭만으로 자동으로 이으면 「김철」↔「김철수산업」 같은 오연결이 난다.
         이름 짐작 건은 후보(사람 확정)로만 */
      const auto = aliasName && exact.length === 1 ? toRef(exact[0]) : null;
      const monthName = namePool.filter((q) => sameMonth(q.d, inv.writeDate));
      const monthSum = monthName.reduce((s, q) => s + Number(q.total), 0);
      const bundle = !auto && monthName.length > 1 && monthSum === inv.total ? monthName.map(toRef) : null;
      // 수정·추가 발행은 나중 달에 온다 — 후보는 ±60일까지 (사장님 제보 2026-08-25)
      let candidates = namePool.filter((q) => dayDiff(q.d, inv.writeDate) <= 60).slice(0, 6).map(toRef);
      if (!auto && candidates.length === 0) {
        /* 이름으로 못 찾으면 같은 금액 — 🔴 사장님 케이스(2026-08-26 타이어프로 속초점): 남의 카드 판매
           (「고객 · 600,000원 · 카드」)가 금액만 같다고 사업자 매출 계산서 후보로 떴다. 카드·현금 판매는
           계산서와 짝이 아니므로 뺀다(계좌이체·외상·혼합만) */
        candidates = freeQuotes
          .filter(
            (q) =>
              Number(q.total) === Math.abs(inv.total) &&
              dayDiff(q.d, inv.writeDate) <= 60 &&
              q.pm !== "카드" &&
              q.pm !== "현금",
          )
          .slice(0, 5)
          .map(toRef);
      }
      /* 통장 입금 직접 연결 후보 — 금액 일치, 작성일 −7 ~ +60일.
       * ⭐ 기억된 입금자(★)는 우선·기간 +120일 (사장님 제보 — 「이관우」처럼 개인 이름으로
       *   정산이 와도 한 번 이으면 'T:사업자번호' 별명으로 기억돼 바로 알아본다) */
      /* ⭐ 대행정산 상대는 계산서 금액 ≠ 입금 금액일 수 있다 (수수료 차감·여러 계산서 합산 —
       *   사장님 제보 2026-08-25). 기억된 입금자·대행정산 유형이면 차액이 있어도 보여주고
       *   차액을 라벨에 적는다. 부분 연결된 입금은 남은 금액으로 견준다. */
      // (2025 감사 F20: 대행정산 유형은 후보 생성에 영향이 없다 — 미사용 변수 정리)
      const sellPool = freeDeposits
        .map((x) => {
          const payer = payerKeyOf("통장", x.description);
          const known =
            aliasMap.has(`${norm(payer)}@${inv.counterBizNo}`) || samePartyName(payer, inv.counterName);
          const similar = !known && similarPartyName(payer, inv.counterName);
          const nearAmt = x.remain !== inv.total && Math.abs(x.remain - inv.total) <= nearTolerance(inv.total);
          return { x, known, similar, exact: x.remain === inv.total, nearAmt };
        })
        .filter(({ x, known, similar, exact, nearAmt }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          if (nearAmt && !known && !similar) return Math.abs(t - w) <= 30 * 86400000 && !siblingAmt(x.remain, inv); // 수수료 포함 (2025 진행)
          const inWindow = t >= w - (known ? 120 : 45) * 86400000 && t <= w + (known ? 120 : 60) * 86400000; // ★는 앞 120일 (2025 진행)
          /* 🔴 감사 B7(2026-08-25): 대행정산이라도 이름이 닮은(known) 입금만 —
             무차별 후보는 오픈링크에 쫑아수산이 추천되는 오염을 만들었다.
             금액 차이는 known 이면 이미 허용된다 */
          return inWindow && (exact || known || similar) && !siblingAmt(x.remain, inv);
        })
        .sort(
          (a, b) =>
            Number(b.exact) - Number(a.exact) ||
            Number(b.known) - Number(a.known) ||
            Number(b.similar) - Number(a.similar) ||
            Number(b.nearAmt) - Number(a.nearAmt) ||
            dayDiff(a.x.date, inv.writeDate) - dayDiff(b.x.date, inv.writeDate),
        );
      const comboSrc2 = sellPool
        .filter(({ known }) => known)
        .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description, l: x.l }));
      const combo2 = sellPool.some(({ exact }) => exact) ? null : bestCombo(comboSrc2, inv.total);
      const bankCands = sellPool.slice(0, 4).map(({ x, known, similar }) => ({
        id: Number(x.id),
        label: bankLabel(x, true, known, inv.total, similar),
        amount: x.remain,
        date: x.date,
        known,
      }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : candidates,
        bankCands,
        bankCombo: combo2
          ? {
              ids: combo2.picks.map((c) => c.id),
              labels: combo2.picks.map((c) => comboLabel(c, true)),
              total: combo2.sum,
              diff: combo2.sum - inv.total,
            }
          : null,
        fixPairs: [],
        fixOrigin: false,
        supplierId: null,
        supplierName: namePool[0]?.who ?? null,
        learnable: false,
      });
    }
  }

  /* ⑦-3 수정·마이너스 계산서 짝 — 같은 상대, 금액이 정확히 상쇄되는 열린 계산서
   *   (잘못 발행 → 나중에 마이너스 발행하는 관행, 사장님 제보 2026-08-25) */
  /* 🔴 2025 감사 F4·D3: 원본이 둘(재발행 세트 833,000×2 + −833,000)이면 하나만 고르지 않고
     전부 보여줘 사장님이 고른다. 마이너스 계산서에는 통장 후보를 만들지 않는다.
     🔴 2026 감사 G9: 원본은 **그 달 밖**에도 있다(레드캡 −3,541,560 02-07 ↔ +3,541,560 01-30) —
     같은 상대·같은 금액·−90~+30일을 DB에서 찾는다(열린 것만). 원본 쪽에는 통장 후보를 빼고
     「상쇄 먼저」를 알린다. */
  const originIds = new Set<number>();
  for (const s of suggestions) {
    if (s.inv.total >= 0) continue;
    s.bankCands = [];
    s.bankCombo = null;
    s.candidates = [];
    const origins = await db.execute<{ id: number; write_date: string; total: number; item_summary: string | null }>(sql`
      SELECT id, to_char(write_date, 'YYYY-MM-DD') write_date, total, item_summary FROM tax_invoice
      WHERE is_active AND id <> ${s.inv.id} AND counterparty_biz_no = ${s.inv.counterBizNo}
        AND direction = ${s.inv.direction} AND total = ${-s.inv.total}
        AND recon_status IN ('미대조', '제안')
        AND write_date >= ${s.inv.writeDate}::date - 90 AND write_date <= ${s.inv.writeDate}::date + 30
      ORDER BY write_date DESC LIMIT 5
    `);
    s.fixPairs = origins.map((o) => {
      originIds.add(Number(o.id));
      return {
        id: Number(o.id),
        label: `${o.write_date.slice(2)} · ${won(Number(o.total))}원${o.item_summary ? ` · ${o.item_summary}` : ""}${
          o.write_date.slice(0, 7) !== ym ? " (다른 달)" : ""
        }`,
      };
    });
  }
  /* 원본이 이 달, 마이너스가 다음 달인 경우(레드캡 01-30 ↔ 02-07)도 잡는다 — 열린 마이너스를
     이 달 ±창에서 찾아 같은 상대·같은 금액의 양수를 원본 후보로 */
  const negsNear = await db.execute<{ biz: string; direction: string; total: number }>(sql`
    SELECT counterparty_biz_no biz, direction, total FROM tax_invoice
    WHERE is_active AND total < 0 AND recon_status IN ('미대조', '제안')
      AND write_date >= ${mr.start}::date - 30 AND write_date < ${mr.nextStart}::date + 90
    -- 🔴 LIMIT 없음 (2026-08-28): 잘리면 상쇄할 원본을 못 찾아 마이너스 계산서에
    --    통장 후보가 다시 뜬다 (2025 감사 F4 재발). 창(±90일)이 이미 범위를 좁힌다.
  `);
  const negKeys = new Set(negsNear.map((n) => `${n.biz}|${n.direction}|${-Number(n.total)}`));
  for (const s of suggestions) {
    if (s.inv.total > 0 && negKeys.has(`${s.inv.counterBizNo}|${s.inv.direction}|${s.inv.total}`)) originIds.add(s.inv.id);
  }
  for (const s of suggestions) {
    if (!originIds.has(s.inv.id)) continue;
    s.fixOrigin = true;
    s.bankCands = [];
    s.bankCombo = null;
    s.auto = null;
    s.bundle = null;
  }

  /* 앱 기록이 이 달에 있나 — 🔴 2026 감사 G11: 전엔 ±75일 풀의 length(=LIMIT 1000)라
     6월에 "앱 매입 49건"이 찍혔다(실제 0). 보는 달 count(*) 로 */
  const [appCnt] = await db.execute<{ p: number; q: number }>(sql`
    SELECT (SELECT count(*)::int FROM purchase_invoice WHERE status <> '취소'
              AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) >= ${mr.start}
              AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) < ${mr.nextStart}) p,
           (SELECT count(*)::int FROM quote WHERE status = '성사'
              AND COALESCE(work_date, (created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${mr.start}::date
              AND COALESCE(work_date, (created_at AT TIME ZONE 'Asia/Seoul')::date) < ${mr.nextStart}::date) q
  `);

  // ⑧ 상대(사업자번호)별 그룹 — 미지정 상대 먼저, 건수 많은 순
  const byParty = new Map<string, PartyGroup>();
  for (const s of suggestions) {
    let g = byParty.get(s.inv.counterBizNo);
    if (!g) {
      g = {
        bizNo: s.inv.counterBizNo,
        name: s.inv.counterName,
        kind: ruleMap.get(s.inv.counterBizNo) ?? null,
        count: 0,
        sum: 0,
        items: [],
        bankBundle: null,
      };
      byParty.set(s.inv.counterBizNo, g);
    }
    g.count++;
    g.sum += s.inv.total;
    g.items.push(s);
  }
  /* 그룹별 「통장 한 줄 = 계산서 N장」 — 같은 방향 계산서끼리, 후보에 오른 줄(★·≈) 중에서 */
  for (const g of byParty.values()) {
    if (g.kind === "월정산") continue;
    for (const dir of ["매입", "매출"] as const) {
      const items = g.items.filter((s) => s.inv.direction === dir && !s.fixOrigin && s.inv.total > 0);
      if (items.length < 2) continue;
      const lines = items.flatMap((s) => s.bankCands.map((b) => ({ id: b.id, amount: b.amount, label: b.label })));
      const bundle = findBankBundle(
        items.map((s) => ({ id: s.inv.id, total: s.inv.total, label: `${s.inv.writeDate.slice(5)} ${won(s.inv.total)}원` })),
        lines,
      );
      if (bundle) {
        g.bankBundle = bundle;
        break;
      }
    }
  }
  const groups = [...byParty.values()].sort((a, b) => {
    if (!!a.kind !== !!b.kind) return a.kind ? 1 : -1;
    return b.count - a.count;
  });

  return {
    groups,
    openCount: Number(openCnt.n),
    autoCount: suggestions.filter((s) => s.auto).length,
    doneCount: counts.find((c) => c.s === "확정")?.n ?? 0,
    ignoredCount: counts.find((c) => c.s === "무시")?.n ?? 0,
    reasonCounts: reasons.map((r) => ({ reason: r.reason, n: Number(r.n) })),
    supplierOptions: suppliers.map((s) => ({ id: Number(s.id), name: s.name })),
    appPurchasesN: Number(appCnt?.p ?? 0),
    appQuotesN: Number(appCnt?.q ?? 0),
  };
}

/* ================================================================== */
/* ⭐ 돈 확인 (tax 재설계, 사장님 승인 2026-08-25)                        */
/*   "이 계산서, 돈이 실제로 나갔나/들어왔나" — 화면의 단일 답변처.        */
/*   bank_ok = 직접(계산서↔통장) OR 간접(계산서↔앱기록↔통장: 지급 잡기·   */
/*   외상 수금으로 이미 소진된 출금·입금의 계산서가 막다른 길이 안 되게).  */

export interface TaxCashRow {
  id: number;
  d: string;
  /** YYYY-MM-DD — 통장 검색 앵커 */
  writeDate: string;
  name: string;
  total: number;
  /** 앱 기록(매입/판매)과는 이어져 있음 — 돈만 미확인 */
  appLinked: boolean;
  /** 지금까지 직접 확인된 통장 금액(+차액 조정) — 0<이 값<total 이면 「일부 확인」 */
  bankCovered: number;
  autoBank: { id: number; label: string; known: boolean; amount: number }[];
  /** 통장 한 줄이 이 상대의 계산서 여러 장 합과 정확히 맞음 — 한꺼번에 잇기 (같은 줄이 관련 행마다 붙는다) */
  bankBundle: BankBundle | null;
  /** 여러 통장 줄의 합이 남은 금액과 맞는(허용 오차 안) 조합. diff = 합 − 남은 금액 */
  bankCombo: { ids: number[]; labels: string[]; total: number; diff: number } | null;
  /** 마이너스(수정) 계산서 — 통장이 아니라 원본과 상쇄해야 끝난다 (「계산서 정리」로) */
  isFix: boolean;
  /** 같은 상대의 열린 마이너스 계산서가 이 금액을 상쇄한다 — 통장보다 상쇄가 먼저 (2026 감사 G9) */
  fixFirst: boolean;
}

/**
 * ⭐ 월정산 거래처 (사장님 승인 2026-08-25)
 *   미쉐린처럼 「월말 합계 계산서 + 수시 분할결제」인 상대 — 계산서 1장과 출금 1건이
 *   1:1로 대응하지 않으므로(실측 42건↔107건) 월 단위 잔액으로 본다.
 */
export interface MonthlyParty {
  bizNo: string;
  name: string;
  invN: number;
  invSum: number;
  paidN: number;
  paidSum: number;
  /** 누적 미지급 = 보는 달까지의 계산서 − 보는 달까지의 지급 (원장의 그 달 누적과 같은 값) */
  balance: number;
  /**
   * 이 달 계산서의 돈 확인이 끝났나
   *
   * 🔴 **「월정산으로 확인했나」가 아니라 「열린 게 없나」다** (사장님 제보 2026-08-27:
   *    "이 달 맞음 — 확인 눌러도 변화가 없음").
   *    전에는 `recon_reason = '월정산'` 인 것만 셌다. 그래서 그 달 계산서를 **개별로
   *    이어 두면**(확정/출금연결) done_n=0 · open_n=0 이 되어 confirmed=false,
   *    버튼이 계속 뜨는데 누르면 고칠 대상(미대조·제안)이 없어 **0건**이었다.
   *    7월 5곳·8월 2곳이 이 상태였다 — 강남세차장·스칼릿·쌍성트레이딩·엠에프티코리아·
   *    위즈오토코리아·한국타이어 티스테이션.
   */
  confirmed: boolean;
  /** 아직 열린(미대조·제안) 건수 — 0이면 확인이 끝난 것이다 */
  openN: number;
  /** 그중 「이 달 맞음」으로 확인한 건수. 0이면 개별로 이은 것이라 여기서 되돌릴 게 없다 */
  monthlyN: number;
}

export interface TaxCashData {
  direction: "매입" | "매출";
  ym: string;
  total: { n: number; sum: number };
  /** 돈 확인 완료 — 직접 확인 합(차액 조정 포함)이 금액을 채웠거나, 간접(지급 잡기) 확인 */
  bankOk: { n: number; sum: number };
  /** 아직 안 끝난 것 — 일부 확인 포함 */
  open: { n: number; sum: number };
  ignoredN: number;
  /**
   * ⭐ 「아직 안 들어옴 / 아직 안 줌」으로 미뤄 둔 계산서 (사장님 질문 2026-08-27)
   *
   *   "카랑은 보통 다음달에 입금을 해주는데 아직 안 들어온 건 어떻게 처리해야하나?"
   *
   * 「무시」와 다르다 — 무시는 셈에서 빼는 것이라 **받을 돈을 잊는다.**
   * 이건 "아직 안 왔다, 다음에 온다"이다. 이 달 할 일에서는 빠지되 여기 남아 있고,
   * 통장 후보 풀에는 그대로 있어 다음 달 입금이 오면 그때 이으면 확정이 된다.
   */
  waiting: { id: number; d: string; name: string; total: number }[];
  waitingSum: number;
  /** 돈 미확인 계산서 — 금액 큰 순 LIMIT 50 */
  rows: TaxCashRow[];
  moreN: number;
  /** 월정산으로 지정한 상대 — 개별 잇기 대신 잔액으로 본다 */
  monthly: MonthlyParty[];
}

/* 계산서별 확인 상태 — cov: 직접 확인 합(통장 연결 + 「차액 확인 끝」 조정),
   ind: 간접(계산서↔앱기록↔지급 잡기·외상 수금). 완료 = cov ≥ total OR ind.
   여러 출금을 합쳐 발행된 계산서·적립 차액(사장님 제보 2026-08-25)을 부분 확인으로 지원 */
export const CASH_LAT = sql`CROSS JOIN LATERAL (
  SELECT (SELECT COALESCE(SUM(m.amount), 0)::bigint FROM recon_match m
           WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id AND m.status = '확정'
             AND m.kind IN ('매입계산서', '매출계산서') AND m.ref_table IN ('cash_txn', 'adjust')) AS cov,
         EXISTS (SELECT 1 FROM recon_match m1 JOIN recon_match m2
                   ON m2.ref_table = m1.ref_table AND m2.ref_id = m1.ref_id
                 WHERE m1.src_table = 'tax_invoice' AND m1.src_id = t.id AND m1.status = '확정'
                   AND m1.ref_table IN ('purchase_invoice', 'quote')
                   AND m1.kind IN ('매입계산서', '매출계산서')
                   AND m2.src_table = 'cash_txn' AND m2.kind IN ('매입지급', '이체입금') AND m2.status = '확정') AS ind
) x`;
/* 🔴 수리(2026-08-25): recon_reason 이 NULL 이면 `= '월정산'` 이 NULL 이 되고
   `AND DONE`·`AND NOT DONE` 양쪽 FILTER 에서 다 빠져 계산서가 집계에서 실종된다
   (7월 31건 중 14건이 사라졌다). COALESCE 로 NULL 전파를 끊는다. */
// 🔴 감사 B8(2026-08-25): 음수(수정) 계산서는 cov(0)≥total 로 자동 확인되던 것 차단
export const DONE = sql`(t.total > 0 AND (x.cov >= t.total OR x.ind OR COALESCE(t.recon_reason, '') = '월정산'))`;

/**
 * ⭐ 「이 달 셈에 드는 계산서」 정본 (2026-08-28)
 *
 * 🔴 **왜 모듈 범위로 올렸나** — 전에는 이 규칙이 `taxCashData` 안의 지역 상수라
 *    현황 카드·월 마감이 쓰는 `taxOpenCounts` 는 `recon_status <> '무시'` 를 손으로
 *    따로 적고 있었다. 그래서 「아직 안 들어옴 — 다음 달로」로 미룬 계산서를
 *    **돈 확인 화면은 빼고 현황·마감은 세어** 같은 달에 두 숫자가 갈라졌다.
 *    「대기」를 만든 이유가 "그래야 달이 닫힌다" 였는데, 정작 마감 체크리스트
 *    (`month-close.ts` — `ok: taxN === 0`)가 그걸 세는 바람에 달이 영영 안 닫혔다.
 *    (감사 C1·N1 이 두 번 고쳤던 「첫 화면 ↔ 탭 숫자 불일치」의 세 번째 재발이다.)
 *
 *    「무시」 = 없던 일로 한다 · 「대기」 = 돈이 아직 안 왔을 뿐이다 —
 *    둘 다 **이 달 할 일은 아니다.** 세는 곳이 하나면 다시는 안 갈라진다.
 */
export const LIVE = sql.raw("t.recon_status NOT IN ('무시', '대기')");

export async function taxCashData(direction: "매입" | "매출", ym: string): Promise<TaxCashData> {
  const { start, nextStart } = monthRange(ym);
  const inMonth = sql`t.is_active AND t.direction = ${direction}
    AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date`;

  /* 🔴 「대기」(아직 안 들어옴)는 이 달 셈에서 뺀다 — 그래야 달이 닫힌다.
        「무시」와 달리 없던 일이 아니라 **다음에 올 돈**이므로 따로 세어 보여 준다.
        정의는 모듈 위 LIVE 한 벌 (2026-08-28) — 현황·마감이 같은 것을 쓴다. */
  const [agg] = await db.execute<{
    total_n: number; total_s: string; ok_n: number; ok_s: string;
    open_n: number; open_s: string; ign_n: number; wait_s: string;
  }>(sql`
    SELECT count(*) FILTER (WHERE ${LIVE})::int total_n,
           COALESCE(SUM(t.total) FILTER (WHERE ${LIVE}), 0)::bigint total_s,
           count(*) FILTER (WHERE ${LIVE} AND ${DONE})::int ok_n,
           COALESCE(SUM(t.total) FILTER (WHERE ${LIVE} AND ${DONE}), 0)::bigint ok_s,
           count(*) FILTER (WHERE ${LIVE} AND NOT ${DONE})::int open_n,
           COALESCE(SUM(t.total) FILTER (WHERE ${LIVE} AND NOT ${DONE}), 0)::bigint open_s,
           count(*) FILTER (WHERE t.recon_status = '무시')::int ign_n,
           COALESCE(SUM(t.total) FILTER (WHERE t.recon_status = '대기'), 0)::bigint wait_s
    FROM tax_invoice t ${CASH_LAT} WHERE ${inMonth}
  `);

  /* 미뤄 둔 것 — 그 달 화면에 「아직 안 들어온 돈」 카드로 남는다 */
  const waitingRows = await db.execute<{ id: number; d: string; name: string; total: number }>(sql`
    SELECT id, to_char(write_date, 'MM-DD') d, counterparty_name name, total
    FROM tax_invoice t
    WHERE ${inMonth} AND t.recon_status = '대기'
    ORDER BY ABS(total) DESC LIMIT 50
  `);

  /* ⭐ 월정산 상대 — 개별 목록에서 빼고 잔액 카드로 (사장님 승인 2026-08-25) */
  /* 🔴 감사 B3(2026-08-25): 월정산 흐름은 「이 방향·이 달에 계산서가 있는 상대」만 —
     방향 무관 제외는 반대 방향 계산서를 영구 실종시키고(미쉐린 8월 매입 1,045,000원)
     0건짜리 죽은 카드를 만들었다 */
  /* 🔴 2025 감사 F2(2026-08-26): 월정산은 채무(매입) 장부다. 매출 방향에 적용하면 우리가 준
     돈이 「못 받은 돈」에 더해져 부호가 뒤집힌다(맥스런 "이 달 입금 −6,907,520"). 매출 계산서는
     월정산 상대라도 일반 행(상계 후보)으로 본다. */
  const monthlyRules =
    direction === "매입"
      ? await db.execute<{ biz_no: string; name_raw: string }>(sql`
          SELECT r.biz_no, r.name_raw FROM tax_party_rule r
          WHERE r.kind = '월정산'
            AND EXISTS (SELECT 1 FROM tax_invoice t2 WHERE t2.is_active
                          AND t2.direction = ${direction}
                          AND t2.counterparty_biz_no = r.biz_no
                          AND t2.write_date >= ${start}::date AND t2.write_date < ${nextStart}::date)
          LIMIT 50
        `)
      : [];
  const monthlyBiz = monthlyRules.map((r) => r.biz_no);
  const notMonthly =
    monthlyBiz.length > 0
      ? sql`AND t.counterparty_biz_no NOT IN (${sql.join(monthlyBiz.map((b) => sql`${b}`), sql`, `)})`
      : sql``;

  const rows = await db.execute<{
    id: number; d: string; write_date: string; name: string; biz: string; total: number;
    app_linked: boolean; bank_covered: string;
  }>(sql`
    SELECT t.id, to_char(t.write_date, 'MM-DD') d, to_char(t.write_date, 'YYYY-MM-DD') write_date,
           t.counterparty_name name, t.counterparty_biz_no biz, t.total,
           EXISTS (SELECT 1 FROM recon_match m WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id
                   AND m.ref_table IN ('purchase_invoice', 'quote')
                   AND m.kind IN ('매입계산서', '매출계산서')) app_linked,
           x.cov bank_covered
    FROM tax_invoice t ${CASH_LAT}
    WHERE ${inMonth} AND ${LIVE} AND NOT ${DONE} ${notMonthly}
    ORDER BY ABS(t.total) DESC, t.id DESC LIMIT 50
  `);

  // 월정산 상대별 — 이 달 계산서 / 이 달 지급 / 누적 잔액 (순차)
  const monthly: MonthlyParty[] = [];
  let monthlyOpenN = 0; // 월정산 상대의 「이 달 맞음」 대기 건수 — moreN 정직화(B3)
  for (const mr of monthlyRules) {
    const [inv] = await db.execute<{ n: number; s: string; done_n: number; open_n: number; all_s: string; nm: string }>(sql`
      SELECT count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date)::int n,
             COALESCE(SUM(total) FILTER (WHERE write_date >= ${start}::date
                                AND write_date < ${nextStart}::date), 0)::bigint s,
             count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date
                                AND recon_reason = '월정산')::int done_n,
             count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date
                                AND recon_status IN ('미대조', '제안'))::int open_n,
             -- 잔액은 「무시」 포함 (발행된 건 다 채무). 🔴 2025 감사 F1: 보는 달까지만 —
             -- 전 기간 합이면 2025-01 카드에도 오늘 잔액(4,364만)이 찍혀 원장(741만)과 어긋났다
             COALESCE(SUM(total) FILTER (WHERE write_date < ${nextStart}::date), 0)::bigint all_s,
             COALESCE(max(counterparty_name), ${mr.name_raw}) nm
      FROM tax_invoice
      WHERE is_active AND direction = ${direction} AND counterparty_biz_no = ${mr.biz_no}
    `);
    /* 🔴 감사 B5(2026-08-25): 지급 합은 원장과 같은 정본(partyStrictNames +
       partyMonthlyCash) — 환불·상계 입금을 차감하고 '미쉐린'류 짧은 약칭의 과다
       매칭(미쉐린로열 33만원 혼입)을 없앤다. 월정산 카드 잔액 ≡ 거래처 원장 잔액 */
    const strict = await partyStrictNames(mr.biz_no);
    const cashByYm = await partyMonthlyCash(strict);
    const isIn2 = direction === "매출";
    const mm = cashByYm.get(ym) ?? { outS: 0, inS: 0, n: 0 };
    const paidMonth = isIn2 ? mm.inS - mm.outS : mm.outS - mm.inS;
    let paidAll = 0; // 보는 달까지의 누적 지급 (F1)
    for (const [ym2, v] of cashByYm) if (ym2 <= ym) paidAll += isIn2 ? v.inS - v.outS : v.outS - v.inS;
    monthlyOpenN += Number(inv?.open_n ?? 0);
    const openN = Number(inv?.open_n ?? 0);
    const monthlyN = Number(inv?.done_n ?? 0);
    monthly.push({
      bizNo: mr.biz_no,
      name: inv?.nm ?? mr.name_raw,
      invN: Number(inv?.n ?? 0),
      invSum: Number(inv?.s ?? 0),
      paidN: Number(mm.n),
      paidSum: paidMonth,
      balance: Number(inv?.all_s ?? 0) - paidAll,
      /* 🔴 감사 C2 의 「월정산 확인이 실제로 있을 때만」을 뒤집었다 (2026-08-27) —
         개별로 이어 확인이 끝난 달까지 「확인 전」으로 보여 주고, 버튼은 0건을 고쳤다.
         계산서가 있고(n>0) 열린 게 없으면(open_n=0) **어떻게 확인했든 끝난 것**이다. */
      confirmed: Number(inv?.n ?? 0) > 0 && openN === 0,
      openN,
      monthlyN,
    });
  }

  // 통장 후보 풀 — taxReconV2 ⑦과 같은 규칙(금액 정확 일치 OR 기억된 상대, 대행정산은 느슨).
  // 🔴 소진량은 정본(cashUsedMap) 기준의 남은 금액
  const used = await cashUsedMap();
  const isIn = direction === "매출";
  const pool = await db.execute<{ id: number; date: string; description: string; amt: number; l: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           description, ${isIn ? sql.raw("in_amount") : sql.raw("out_amount")} amt, account_label l
    FROM cash_txn
    WHERE source = '통장' AND is_active AND ${isIn ? sql.raw("in_amount > 0") : sql.raw("out_amount > 0")}
      ${isIn ? sql`AND category IS NULL` : sql`AND (category IS NULL OR category = '매입대금')`}
      AND recon_status <> '확정'
      -- 🔴 2025 감사 F10: 양단 날짜 고정 (상한 없는 id DESC 800 은 2025 달의 풀을 2026 줄로 채운다)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date - 120 -- ★ 뒤창 120일 (2025 진행)
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date + 150
    ORDER BY occurred_at DESC LIMIT 800
  `);
  const free = pool
    .map((x) => ({ ...x, remain: Number(x.amt) - (used.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);
  const aliases2 = await db.execute<{ alias_key: string }>(sql`
    SELECT alias_key FROM party_alias
    -- 🔴 LIMIT 없음 (2026-08-28): 별명은 「이을 때마다 한 줄씩 늘어나는」 표다. 잘려도
    --    오류가 안 나고 ★(기억된 상대)만 조용히 꺼져 후보·자동잇기가 틀리기 시작한다.
  `);
  const aliasKeys = new Set(aliases2.map((a) => a.alias_key));
  const rules2 = await db.execute<{ biz_no: string; kind: string }>(sql`
    SELECT biz_no, kind FROM tax_party_rule LIMIT 1000
  `);
  const ruleMap2 = new Map(rules2.map((r) => [r.biz_no, r.kind]));

  // 열린 마이너스 계산서(이 방향, 이 달 ±) — 원본 쪽은 통장 후보 대신 「상쇄 먼저」 (G9)
  const negs = await db.execute<{ biz: string; total: number }>(sql`
    SELECT counterparty_biz_no biz, total FROM tax_invoice
    WHERE is_active AND direction = ${direction} AND total < 0 AND recon_status IN ('미대조', '제안')
      AND write_date >= ${start}::date - 30 AND write_date < ${nextStart}::date + 90
    -- 🔴 LIMIT 없음 (2026-08-28): 잘리면 상쇄할 원본을 못 찾아 마이너스 계산서에
    --    통장 후보가 다시 뜬다 (2025 감사 F4 재발). 창(±90일)이 이미 범위를 좁힌다.
  `);
  const negKeys = new Set(negs.map((n) => `${n.biz}|${-Number(n.total)}`));
  // 같은 상대의 다른 열린 계산서 금액 — 그 몫인 통장 줄은 이 계산서 후보에서 뺀다 (사장님 지적 2026-08-26)
  const openInv = await db.execute<{ biz: string; total: number }>(sql`
    SELECT t.counterparty_biz_no biz, t.total FROM tax_invoice t ${CASH_LAT}
    WHERE ${inMonth} AND t.recon_status <> '무시' AND NOT ${DONE} LIMIT 2000
  `);
  const openByBiz = new Map<string, number[]>();
  for (const o of openInv) openByBiz.set(o.biz, [...(openByBiz.get(o.biz) ?? []), Number(o.total)]);

  const outRows: TaxCashRow[] = rows.map((r) => {
    const total = Number(r.total) - Number(r.bank_covered); // 후보 매칭은 남은 금액 기준
    const siblingCash = (amt: number) =>
      amt !== total && amt !== Number(r.total) && (openByBiz.get(r.biz) ?? []).some((t) => t === amt);
    if (negKeys.has(`${r.biz}|${Number(r.total)}`)) {
      return {
        id: Number(r.id), d: r.d, writeDate: r.write_date, name: r.name, total: Number(r.total),
        appLinked: !!r.app_linked, bankCovered: Number(r.bank_covered),
        autoBank: [], bankCombo: null, bankBundle: null, isFix: false, fixFirst: true,
      };
    }
    /* 🔴 2025 감사 F4: 마이너스(수정) 계산서는 통장으로 못 끝낸다 — 후보를 만들지 않고
       「계산서 정리」에서 원본과 상쇄하라고 안내한다 (전에는 +833,000 입금을 추천했다) */
    if (Number(r.total) < 0) {
      return {
        id: Number(r.id), d: r.d, writeDate: r.write_date, name: r.name, total: Number(r.total),
        appLinked: !!r.app_linked, bankCovered: Number(r.bank_covered),
        autoBank: [], bankCombo: null, bankBundle: null, isFix: true, fixFirst: false,
      };
    }
    const pool2 = free
      .map((x) => {
        const payer = payerKeyOf("통장", x.description);
        // 기억된 이름 + 닮은 이름(적요 잘림 견딤) 둘 다 ★ (2026-08-25)
        const known = aliasKeys.has(`${normName(payer)}@${r.biz}`) || samePartyName(payer, r.name);
        const similar = !known && similarPartyName(payer, r.name);
        const nearAmt = x.remain !== total && Math.abs(x.remain - total) <= nearTolerance(total);
        return { x, known, similar, exact: x.remain === total, nearAmt };
      })
      .filter(({ x, known, similar, exact, nearAmt }) => {
        const t = new Date(x.date).getTime();
        const w = new Date(r.write_date).getTime();
        if (nearAmt && !known && !similar) return Math.abs(t - w) <= 30 * 86400000 && !siblingCash(x.remain); // 수수료 포함 (2025 진행)
        const back = isIn ? (known ? 120 : 60) : known ? 150 : 90;
        // 월말 합계 계산서 대비 — 그 달 초의 결제까지 후보로 (2026-08-25)
        const inWindow = t >= w - (known ? 120 : 45) * 86400000 && t <= w + back * 86400000; // ★는 앞 90일 (2025 진행)
        // 🔴 감사 B7: 이름 무관 후보(대행정산 loose) 폐지 — 오염 추천의 근원
        return inWindow && (exact || known || similar) && !siblingCash(x.remain);
      })
      .sort(
        (a, b) =>
          Number(b.exact) - Number(a.exact) ||
          Number(b.known) - Number(a.known) ||
          Number(b.similar) - Number(a.similar) ||
          Number(b.nearAmt) - Number(a.nearAmt) ||
          Math.abs(new Date(a.x.date).getTime() - new Date(r.write_date).getTime()) -
            Math.abs(new Date(b.x.date).getTime() - new Date(r.write_date).getTime()),
      );
    const comboSrc3 = pool2
      .filter(({ known }) => known)
      .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description }));
    const combo3 = pool2.some(({ exact }) => exact) ? null : bestCombo(comboSrc3, total);
    const cands = pool2.slice(0, 4).map(({ x, known, similar }) => ({
      id: Number(x.id),
      label: bankLabel(x, isIn, known, total, similar),
      known,
      amount: x.remain,
    }));
    return {
      id: Number(r.id),
      d: r.d,
      writeDate: r.write_date,
      name: r.name,
      total: Number(r.total),
      appLinked: !!r.app_linked,
      bankCovered: Number(r.bank_covered),
      autoBank: cands,
      bankCombo: combo3
        ? {
            ids: combo3.picks.map((c) => c.id),
            labels: combo3.picks.map((c) => comboLabel(c, isIn)),
            total: combo3.sum,
            diff: combo3.sum - total,
          }
        : null,
      bankBundle: null,
      isFix: false,
      fixFirst: false,
    };
  });
  /* 상대별 「통장 한 줄 = 계산서 N장」 (사장님 케이스 2026-08-26) — 관련 행마다 같은 묶음을 붙인다 */
  const byBiz = new Map<string, TaxCashRow[]>();
  for (const r of rows) {
    const row = outRows.find((o) => o.id === Number(r.id));
    if (row && !row.isFix && !row.fixFirst && row.bankCovered === 0) byBiz.set(r.biz, [...(byBiz.get(r.biz) ?? []), row]);
  }
  for (const group of byBiz.values()) {
    if (group.length < 2) continue;
    const bundle = findBankBundle(
      group.map((o) => ({ id: o.id, total: o.total, label: `${o.d} ${won(o.total)}원` })),
      group.flatMap((o) => o.autoBank.map((b) => ({ id: b.id, amount: b.amount, label: b.label }))),
    );
    if (bundle) for (const o of group) if (bundle.invoiceIds.includes(o.id)) o.bankBundle = bundle;
  }

  return {
    direction,
    ym,
    total: { n: Number(agg.total_n), sum: Number(agg.total_s) },
    bankOk: { n: Number(agg.ok_n), sum: Number(agg.ok_s) },
    open: { n: Number(agg.open_n), sum: Number(agg.open_s) },
    ignoredN: Number(agg.ign_n),
    waiting: waitingRows.map((w) => ({
      id: Number(w.id), d: w.d, name: w.name, total: Number(w.total),
    })),
    waitingSum: Number(agg.wait_s ?? 0),
    rows: outRows,
    moreN: Math.max(0, Number(agg.open_n) - outRows.length - monthlyOpenN),
    monthly,
  };
}

/**
 * ⭐ 현황 대시보드용 경량 카운트 (감사 C1, 2026-08-25) — 돈 확인 뷰와 같은 정의
 *    (bank_ok 기준, 매입+매출, 이 달). 첫 화면 8건 ↔ 탭 9건 불일치의 해결.
 */
export async function taxOpenCount(ym: string): Promise<number> {
  const c = await taxOpenCounts(ym);
  return c.buy + c.sell;
}

/** 방향별 돈 확인 할 일 — 현황 카드가 "매입 a · 매출 b"로 보여 준다 (2026 감사 N1: 합만 보이면 탭 숫자와 어긋나 보였다) */
export async function taxOpenCounts(ym: string): Promise<{ buy: number; sell: number }> {
  const { start, nextStart } = monthRange(ym);
  const [r] = await db.execute<{ b: number; s: number }>(sql`
    SELECT count(*) FILTER (WHERE t.direction = '매입')::int b,
           count(*) FILTER (WHERE t.direction = '매출')::int s
    FROM tax_invoice t ${CASH_LAT}
    -- 🔴 2026-08-28: 손으로 적던 「무시만 제외」를 정본 LIVE 로 — 「대기」가 여기서만 세이던 문제
    WHERE t.is_active AND ${LIVE} AND NOT ${DONE}
      AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date
  `);
  return { buy: Number(r?.b ?? 0), sell: Number(r?.s ?? 0) };
}
