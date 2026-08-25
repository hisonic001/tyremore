/**
 * ⭐ 세금계산서 대조 v2 — 후보 계산 (사장님 승인 2026-08-25 리빌딩)
 *
 *   v1 의 문제(실측): ①미대조의 98%가 앱 도입 전 과거분 ②매출 상대가 대부분
 *   보험·렌터카 「대행 정산사」(카랑·레드캡투어…)인데 거래처 판매만 뒤짐
 *   ③경비성 매입(세무법인·네이버…)이 계속 화면에 남음.
 *
 *   v2 원칙:
 *   - 대조 대상 = 앱 도입(2026-08) 이후. 과거분은 접고 일괄 처리.
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
import { cashUsedMap, normName, partyMatchSql, samePartyName } from "./recon-data";
import { monthRange } from "./ym";

/** 앱 실사용 시작 — 이전 계산서는 대조가 원리적으로 불가능하다 */
export const TAX_APP_START = "2026-08-01";

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
}

export interface TaxSuggestion {
  inv: TaxRow;
  auto: CandidateRef | null;
  bundle: CandidateRef[] | null;
  candidates: CandidateRef[];
  bankCands: BankRef[];
  /** 여러 통장 줄의 합이 계산서와 정확히 맞는 조합 — 한꺼번에 잇는다 */
  bankCombo: { ids: number[]; labels: string[]; total: number } | null;
  /** 마이너스(수정) 계산서의 원본으로 보이는 짝 — 함께 상쇄 정리 */
  fixPair: { id: number; label: string } | null;
  supplierId: number | null;
  supplierName: string | null;
  learnable: boolean;
}

export interface PartyGroup {
  bizNo: string;
  name: string;
  /** tax_party_rule 의 유형 — null 이면 미지정 */
  kind: string | null;
  count: number;
  sum: number;
  items: TaxSuggestion[];
}

export interface TaxReconV2 {
  groups: PartyGroup[];
  openCount: number;
  autoCount: number;
  doneCount: number;
  ignoredCount: number;
  /** 아직 미대조로 남은 과거분 (재업로드 등) — [일괄 처리]의 대상 */
  pastCount: number;
  pastSum: number;
  reasonCounts: { reason: string; n: number }[];
  supplierOptions: { id: number; name: string }[];
}

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 출금·입금 조합 찾기 (사장님 제보 2026-08-25 — 위즈오토 7월 계산서 1,531,222원이
 *    7/8 840,092 + 7/8 500,940 + 7/12 190,190 세 건의 합과 정확히 같았다).
 *
 *    월합계 계산서를 쓰는 곳은 결제를 건별로 나눠 하므로, 한 건씩 골라 잇는 대신
 *    **합이 딱 맞는 조합**을 찾아 한꺼번에 이어 준다. 정확히 맞을 때만 제안한다
 *    (근사값은 오히려 헷갈린다). 후보가 많으면(>14) 탐색을 접는다.
 */
export function findAmountCombo<T extends { id: number; amount: number }>(
  cands: T[],
  target: number,
  maxPick = 4,
): T[] | null {
  if (target <= 0 || cands.length < 2 || cands.length > 14) return null;
  const pool = cands.filter((c) => c.amount > 0 && c.amount <= target);
  if (pool.length < 2) return null;
  let best: T[] | null = null;
  const pick: T[] = [];
  const dfs = (i: number, left: number) => {
    if (best) return; // 첫 정답이면 충분 (건수 적은 것부터 찾는다)
    if (left === 0 && pick.length >= 2) {
      best = [...pick];
      return;
    }
    if (i >= pool.length || pick.length >= maxPick || left < 0) return;
    for (let j = i; j < pool.length; j++) {
      if (pool[j].amount > left) continue;
      pick.push(pool[j]);
      dfs(j + 1, left - pool[j].amount);
      pick.pop();
      if (best) return;
    }
  };
  // 건수가 적은 조합을 먼저 찾도록 큰 금액부터
  pool.sort((a, b) => b.amount - a.amount);
  dfs(0, target);
  return best;
}
const sameMonth = (a: string | null, b: string) => !!a && a.slice(0, 7) === b.slice(0, 7);
const dayDiff = (a: string | null, b: string): number =>
  a ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 999;

export async function taxReconV2(ym?: string): Promise<TaxReconV2> {
  /* 월별 보기 (사장님 지적 2026-08-25) — ym 을 주면 그 달만. 과거 달(7월)도 열린다:
     되돌린 7월 계산서가 「과거분」 통에 숨어 사라져 보이던 문제의 해결 */
  const mr = ym ? monthRange(ym) : null;
  const invWhere = mr
    ? sql`write_date >= ${mr.start}::date AND write_date < ${mr.nextStart}::date`
    : sql`write_date >= ${TAX_APP_START}::date`;
  const poolStart = mr ? mr.start : TAX_APP_START;
  // ① 열린 계산서 — 실사용 기간만
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

  // ② 상태·사유·과거분 집계
  const counts = await db.execute<{ s: string; n: number }>(sql`
    SELECT recon_status s, count(*)::int n FROM tax_invoice WHERE is_active GROUP BY 1 LIMIT 5
  `);
  const past = await db.execute<{ n: number; s: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(total), 0)::bigint s FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조', '제안') AND write_date < ${TAX_APP_START}::date
  `);
  const reasons = await db.execute<{ reason: string; n: number }>(sql`
    SELECT COALESCE(recon_reason, '직접') reason, count(*)::int n FROM tax_invoice
    WHERE is_active AND recon_status = '무시' GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `);

  // ③ 거래처·별명·상대 유형 사전
  const suppliers = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 500
  `);
  const aliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias LIMIT 2000
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
      -- 🔴 재설계 C3: 최신순 컷 → quotes(감사 M6)와 같은 날짜창
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
          >= to_char(${TAX_APP_START}::date - 75, 'YYYY-MM-DD')
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
      -- 🔴 감사 M6: 최신순 컷이 아니라 날짜창 — 계산서(8월~) ±창을 다 덮게
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${TAX_APP_START}::date - 75
    ORDER BY q.id DESC LIMIT 1000
  `);

  // ⑥ 이미 이어진 기록 제외
  const linked = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    SELECT ref_table, ref_id FROM recon_match
    WHERE kind IN ('매입계산서', '매출계산서') AND ref_table IN ('purchase_invoice', 'quote')
    ORDER BY id LIMIT 10000
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
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${poolStart}::date - 7
    ORDER BY id DESC LIMIT 800
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
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${poolStart}::date - 7
    ORDER BY id DESC LIMIT 800
  `);
  const freeWithdrawals = withdrawals
    .map((x) => ({ ...x, remain: Number(x.out_amount) - (cashLinked.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);

  const norm = normName;

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
          return { x, known, exact: x.remain === inv.total };
        })
        .filter(({ x, known, exact }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          /* 🔴 창 넓힘(2026-08-25 위즈오토): 월말 합계 계산서는 그 달 내내의 결제를 담는다 —
             7/31 계산서에 7/8·7/12 출금이 짝인데 -7일 창이라 잘려 조합을 못 찾았다. */
          const inWindow = t >= w - 45 * 86400000 && t <= w + (known ? 150 : 90) * 86400000;
          return inWindow && (exact || known); // 기억된 지급처는 차액이 있어도 보여준다
        })
        .sort(
          (a, b) =>
            Number(b.exact) - Number(a.exact) ||
            Number(b.known) - Number(a.known) ||
            // 계산서 날짜에 가까운 것 먼저 (8월 것이 7월 계산서 위로 오던 문제)
            dayDiff(a.x.date, inv.writeDate) - dayDiff(b.x.date, inv.writeDate),
        );
      /* 합이 딱 맞는 조합 — 월합계 계산서 + 건별 결제(위즈오토 케이스) */
      const comboSrc = buyPool
        .filter(({ known }) => known)
        .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description, l: x.l }));
      const combo = buyPool.some(({ exact }) => exact) ? null : findAmountCombo(comboSrc, inv.total);
      const buyBank = buyPool.slice(0, 4).map(({ x, known, exact }) => ({
        id: Number(x.id),
        label:
          `${known ? "★ " : ""}${x.date.slice(5)} · ${x.description.slice(0, 24)} · −${won(x.remain)}원 (${x.l})` +
          (exact ? "" : ` · 계산서보다 ${won(Math.abs(x.remain - inv.total))}원 ${x.remain > inv.total ? "많음" : "적음"}`),
        amount: x.remain,
        date: x.date,
      }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : near,
        bankCands: buyBank,
        bankCombo: combo
          ? {
              ids: combo.map((c) => c.id),
              labels: combo.map((c) => `${c.date.slice(5)} · ${c.desc.slice(0, 20)} · −${won(c.amount)}원`),
              total: combo.reduce((s, c) => s + c.amount, 0),
            }
          : null,
        fixPair: null,
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
        // 이름으로 못 찾으면 같은 금액 (결제수단 무관 — 계좌이체 판매 포함)
        candidates = freeQuotes
          .filter((q) => Number(q.total) === Math.abs(inv.total) && dayDiff(q.d, inv.writeDate) <= 60)
          .slice(0, 5)
          .map(toRef);
      }
      /* 통장 입금 직접 연결 후보 — 금액 일치, 작성일 −7 ~ +60일.
       * ⭐ 기억된 입금자(★)는 우선·기간 +120일 (사장님 제보 — 「이관우」처럼 개인 이름으로
       *   정산이 와도 한 번 이으면 'T:사업자번호' 별명으로 기억돼 바로 알아본다) */
      /* ⭐ 대행정산 상대는 계산서 금액 ≠ 입금 금액일 수 있다 (수수료 차감·여러 계산서 합산 —
       *   사장님 제보 2026-08-25). 기억된 입금자·대행정산 유형이면 차액이 있어도 보여주고
       *   차액을 라벨에 적는다. 부분 연결된 입금은 남은 금액으로 견준다. */
      const partyKind = ruleMap.get(inv.counterBizNo) ?? null;
      const sellPool = freeDeposits
        .map((x) => {
          const payer = payerKeyOf("통장", x.description);
          const known =
            aliasMap.has(`${norm(payer)}@${inv.counterBizNo}`) || samePartyName(payer, inv.counterName);
          return { x, known, exact: x.remain === inv.total };
        })
        .filter(({ x, known, exact }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          const inWindow = t >= w - 45 * 86400000 && t <= w + (known ? 120 : 60) * 86400000;
          return inWindow && (exact || known || partyKind === "대행정산");
        })
        .sort(
          (a, b) =>
            Number(b.exact) - Number(a.exact) ||
            Number(b.known) - Number(a.known) ||
            dayDiff(a.x.date, inv.writeDate) - dayDiff(b.x.date, inv.writeDate),
        );
      const comboSrc2 = sellPool
        .filter(({ known }) => known)
        .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description, l: x.l }));
      const combo2 = sellPool.some(({ exact }) => exact) ? null : findAmountCombo(comboSrc2, inv.total);
      const bankCands = sellPool.slice(0, 4).map(({ x, known, exact }) => ({
        id: Number(x.id),
        label:
          `${known ? "★ " : ""}${x.date.slice(5)} · ${x.description.slice(0, 24)} · +${won(x.remain)}원 (${x.l})` +
          (exact ? "" : ` · 계산서보다 ${won(Math.abs(x.remain - inv.total))}원 ${x.remain > inv.total ? "많음" : "적음"}`),
        amount: x.remain,
        date: x.date,
      }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : candidates,
        bankCands,
        bankCombo: combo2
          ? {
              ids: combo2.map((c) => c.id),
              labels: combo2.map((c) => `${c.date.slice(5)} · ${c.desc.slice(0, 20)} · +${won(c.amount)}원`),
              total: combo2.reduce((s, c) => s + c.amount, 0),
            }
          : null,
        fixPair: null,
        supplierId: null,
        supplierName: namePool[0]?.who ?? null,
        learnable: false,
      });
    }
  }

  /* ⑦-3 수정·마이너스 계산서 짝 — 같은 상대, 금액이 정확히 상쇄되는 열린 계산서
   *   (잘못 발행 → 나중에 마이너스 발행하는 관행, 사장님 제보 2026-08-25) */
  for (const s of suggestions) {
    if (s.inv.total >= 0) continue;
    const origin = suggestions.find(
      (o) =>
        o.inv.id !== s.inv.id &&
        o.inv.counterBizNo === s.inv.counterBizNo &&
        o.inv.total === -s.inv.total &&
        o.inv.writeDate <= s.inv.writeDate,
    );
    if (origin) {
      s.fixPair = {
        id: origin.inv.id,
        label: `${origin.inv.writeDate.slice(5)} · ${won(origin.inv.total)}원 (원본으로 보임)`,
      };
    }
  }

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
      };
      byParty.set(s.inv.counterBizNo, g);
    }
    g.count++;
    g.sum += s.inv.total;
    g.items.push(s);
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
    pastCount: Number(past[0]?.n ?? 0),
    pastSum: Number(past[0]?.s ?? 0),
    reasonCounts: reasons.map((r) => ({ reason: r.reason, n: Number(r.n) })),
    supplierOptions: suppliers.map((s) => ({ id: Number(s.id), name: s.name })),
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
  name: string;
  total: number;
  /** 앱 기록(매입/판매)과는 이어져 있음 — 돈만 미확인 */
  appLinked: boolean;
  /** 지금까지 직접 확인된 통장 금액(+차액 조정) — 0<이 값<total 이면 「일부 확인」 */
  bankCovered: number;
  autoBank: { id: number; label: string }[];
  /** 여러 통장 줄의 합이 남은 금액과 정확히 맞는 조합 */
  bankCombo: { ids: number[]; labels: string[]; total: number } | null;
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
  /** 누적 미지급 = 전체 기간 계산서 − 전체 기간 지급 */
  balance: number;
  /** 이 달 계산서를 「맞음」으로 확인했나 */
  confirmed: boolean;
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
  /** 돈 미확인 계산서 — 금액 큰 순 LIMIT 50 */
  rows: TaxCashRow[];
  moreN: number;
  /** 월정산으로 지정한 상대 — 개별 잇기 대신 잔액으로 본다 */
  monthly: MonthlyParty[];
}

/* 계산서별 확인 상태 — cov: 직접 확인 합(통장 연결 + 「차액 확인 끝」 조정),
   ind: 간접(계산서↔앱기록↔지급 잡기·외상 수금). 완료 = cov ≥ total OR ind.
   여러 출금을 합쳐 발행된 계산서·적립 차액(사장님 제보 2026-08-25)을 부분 확인으로 지원 */
const CASH_LAT = sql`CROSS JOIN LATERAL (
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
const DONE = sql`(x.cov >= t.total OR x.ind OR COALESCE(t.recon_reason, '') = '월정산')`;

export async function taxCashData(direction: "매입" | "매출", ym: string): Promise<TaxCashData> {
  const { start, nextStart } = monthRange(ym);
  const inMonth = sql`t.is_active AND t.direction = ${direction}
    AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date`;

  const [agg] = await db.execute<{
    total_n: number; total_s: string; ok_n: number; ok_s: string;
    open_n: number; open_s: string; ign_n: number;
  }>(sql`
    SELECT count(*) FILTER (WHERE t.recon_status <> '무시')::int total_n,
           COALESCE(SUM(t.total) FILTER (WHERE t.recon_status <> '무시'), 0)::bigint total_s,
           count(*) FILTER (WHERE t.recon_status <> '무시' AND ${DONE})::int ok_n,
           COALESCE(SUM(t.total) FILTER (WHERE t.recon_status <> '무시' AND ${DONE}), 0)::bigint ok_s,
           count(*) FILTER (WHERE t.recon_status <> '무시' AND NOT ${DONE})::int open_n,
           COALESCE(SUM(t.total) FILTER (WHERE t.recon_status <> '무시' AND NOT ${DONE}), 0)::bigint open_s,
           count(*) FILTER (WHERE t.recon_status = '무시')::int ign_n
    FROM tax_invoice t ${CASH_LAT} WHERE ${inMonth}
  `);

  /* ⭐ 월정산 상대 — 개별 목록에서 빼고 잔액 카드로 (사장님 승인 2026-08-25) */
  const monthlyRules = await db.execute<{ biz_no: string; name_raw: string }>(sql`
    SELECT biz_no, name_raw FROM tax_party_rule WHERE kind = '월정산' LIMIT 50
  `);
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
    WHERE ${inMonth} AND t.recon_status <> '무시' AND NOT ${DONE} ${notMonthly}
    ORDER BY ABS(t.total) DESC, t.id DESC LIMIT 50
  `);

  // 월정산 상대별 — 이 달 계산서 / 이 달 지급 / 누적 잔액 (순차)
  const monthly: MonthlyParty[] = [];
  for (const mr of monthlyRules) {
    const [inv] = await db.execute<{ n: number; s: string; done_n: number; open_n: number; all_s: string; nm: string }>(sql`
      SELECT count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date)::int n,
             COALESCE(SUM(total) FILTER (WHERE write_date >= ${start}::date
                                AND write_date < ${nextStart}::date), 0)::bigint s,
             count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date
                                AND recon_reason = '월정산')::int done_n,
             count(*) FILTER (WHERE write_date >= ${start}::date AND write_date < ${nextStart}::date
                                AND recon_status IN ('미대조', '제안'))::int open_n,
             COALESCE(SUM(total), 0)::bigint all_s, -- 잔액은 「무시」 포함 (발행된 건 다 채무)
             COALESCE(max(counterparty_name), ${mr.name_raw}) nm
      FROM tax_invoice
      WHERE is_active AND direction = ${direction} AND counterparty_biz_no = ${mr.biz_no}
    `);
    // 이 상대의 통장 이름들 — 배운 별명(T:) + 계산서 상호
    const names = await db.execute<{ raw: string }>(sql`
      SELECT alias_raw raw FROM party_alias WHERE party_key = ${"T:" + mr.biz_no} LIMIT 12
    `);
    const pats = [...new Set([...names.map((n) => n.raw), inv?.nm ?? mr.name_raw].filter(Boolean))];
    const isIn2 = direction === "매출";
    const cond = partyMatchSql(pats); // 정본 — 적요 잘림·표기 차이 견딤
    const [pay] = await db.execute<{ n: number; s: string; all_s: string }>(sql`
      SELECT count(*) FILTER (WHERE (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
                                AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date)::int n,
             COALESCE(SUM(${isIn2 ? sql.raw("in_amount") : sql.raw("out_amount")})
                      FILTER (WHERE (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
                                AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date), 0)::bigint s,
             COALESCE(SUM(${isIn2 ? sql.raw("in_amount") : sql.raw("out_amount")}), 0)::bigint all_s
      FROM cash_txn
      WHERE source = '통장' AND is_active
        AND ${isIn2 ? sql.raw("in_amount > 0") : sql.raw("out_amount > 0")}
        AND (${cond})
    `);
    monthly.push({
      bizNo: mr.biz_no,
      name: inv?.nm ?? mr.name_raw,
      invN: Number(inv?.n ?? 0),
      invSum: Number(inv?.s ?? 0),
      paidN: Number(pay?.n ?? 0),
      paidSum: Number(pay?.s ?? 0),
      balance: Number(inv?.all_s ?? 0) - Number(pay?.all_s ?? 0),
      confirmed: Number(inv?.open_n ?? 0) === 0 && Number(inv?.n ?? 0) > 0,
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
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date - 7
    ORDER BY id DESC LIMIT 800
  `);
  const free = pool
    .map((x) => ({ ...x, remain: Number(x.amt) - (used.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);
  const aliases2 = await db.execute<{ alias_key: string }>(sql`
    SELECT alias_key FROM party_alias LIMIT 2000
  `);
  const aliasKeys = new Set(aliases2.map((a) => a.alias_key));
  const rules2 = await db.execute<{ biz_no: string; kind: string }>(sql`
    SELECT biz_no, kind FROM tax_party_rule LIMIT 1000
  `);
  const ruleMap2 = new Map(rules2.map((r) => [r.biz_no, r.kind]));

  const outRows: TaxCashRow[] = rows.map((r) => {
    const total = Number(r.total) - Number(r.bank_covered); // 후보 매칭은 남은 금액 기준
    const loose = isIn && ruleMap2.get(r.biz) === "대행정산";
    const pool2 = free
      .map((x) => {
        const payer = payerKeyOf("통장", x.description);
        // 기억된 이름 + 닮은 이름(적요 잘림 견딤) 둘 다 ★ (2026-08-25)
        const known = aliasKeys.has(`${normName(payer)}@${r.biz}`) || samePartyName(payer, r.name);
        return { x, known, exact: x.remain === total };
      })
      .filter(({ x, known, exact }) => {
        const t = new Date(x.date).getTime();
        const w = new Date(r.write_date).getTime();
        const back = isIn ? (known ? 120 : 60) : known ? 150 : 90;
        // 월말 합계 계산서 대비 — 그 달 초의 결제까지 후보로 (2026-08-25)
        const inWindow = t >= w - 45 * 86400000 && t <= w + back * 86400000;
        return inWindow && (exact || known || loose);
      })
      .sort(
        (a, b) =>
          Number(b.exact) - Number(a.exact) ||
          Number(b.known) - Number(a.known) ||
          Math.abs(new Date(a.x.date).getTime() - new Date(r.write_date).getTime()) -
            Math.abs(new Date(b.x.date).getTime() - new Date(r.write_date).getTime()),
      );
    const comboSrc3 = pool2
      .filter(({ known }) => known)
      .map(({ x }) => ({ id: Number(x.id), amount: x.remain, date: x.date, desc: x.description }));
    const combo3 = pool2.some(({ exact }) => exact) ? null : findAmountCombo(comboSrc3, total);
    const cands = pool2.slice(0, 3).map(({ x, known, exact }) => ({
      id: Number(x.id),
      label:
        `${known ? "★ " : ""}${x.date.slice(5)} · ${x.description.slice(0, 24)} · ${isIn ? "+" : "−"}${won(x.remain)}원 (${x.l})` +
        (exact ? "" : ` · 계산서보다 ${won(Math.abs(x.remain - total))}원 ${x.remain > total ? "많음" : "적음"}`),
    }));
    return {
      id: Number(r.id),
      d: r.d,
      name: r.name,
      total: Number(r.total),
      appLinked: !!r.app_linked,
      bankCovered: Number(r.bank_covered),
      autoBank: cands,
      bankCombo: combo3
        ? {
            ids: combo3.map((c) => c.id),
            labels: combo3.map((c) => `${c.date.slice(5)} · ${c.desc.slice(0, 20)} · ${isIn ? "+" : "−"}${won(c.amount)}원`),
            total: combo3.reduce((s, c) => s + c.amount, 0),
          }
        : null,
    };
  });

  return {
    direction,
    ym,
    total: { n: Number(agg.total_n), sum: Number(agg.total_s) },
    bankOk: { n: Number(agg.ok_n), sum: Number(agg.ok_s) },
    open: { n: Number(agg.open_n), sum: Number(agg.open_s) },
    ignoredN: Number(agg.ign_n),
    rows: outRows,
    moreN: Math.max(0, Number(agg.open_n) - outRows.length),
    monthly,
  };
}
