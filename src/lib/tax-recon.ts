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
import { normName } from "./recon-data";

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

/** 통장 직접 검색용 줄 — 선입금·적립처럼 금액이 아예 다른 경우 사장님이 찾아 잇는다 */
export interface BankPick {
  id: number;
  date: string;
  payer: string;
  label: string;
  remain: number;
}

export interface TaxReconV2 {
  groups: PartyGroup[];
  /** 직접 검색 풀 — in: 입금(매출 계산서용) · out: 출금(매입 계산서용). 남은 금액 있는 줄만 */
  bankPool: { in: BankPick[]; out: BankPick[] };
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
const sameMonth = (a: string | null, b: string) => !!a && a.slice(0, 7) === b.slice(0, 7);
const dayDiff = (a: string | null, b: string): number =>
  a ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 999;

export async function taxReconV2(): Promise<TaxReconV2> {
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
    WHERE is_active AND recon_status IN ('미대조', '제안') AND write_date >= ${TAX_APP_START}::date
    ORDER BY write_date DESC, id DESC LIMIT 150
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
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 200
  `);
  const aliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias LIMIT 500
  `);
  const aliasMap = new Map(aliases.map((a) => [a.alias_key, a.party_key]));
  const rules = await db.execute<{ biz_no: string; kind: string }>(sql`
    SELECT biz_no, kind FROM tax_party_rule LIMIT 300
  `);
  const ruleMap = new Map(rules.map((r) => [r.biz_no, r.kind]));

  // ④ 매입 인보이스 (앱 매입 기록)
  const purchases = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number | null;
  }>(sql`
    SELECT id, supplier, invoice_no,
           COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d, total
    FROM purchase_invoice WHERE status <> '취소' ORDER BY id DESC LIMIT 300
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
    ORDER BY q.id DESC LIMIT 600
  `);

  // ⑥ 이미 이어진 기록 제외
  const linked = await db.execute<{ ref_table: string; ref_id: number; amount: number }>(sql`
    SELECT ref_table, ref_id, amount FROM recon_match
    WHERE kind IN ('매입계산서', '매출계산서') LIMIT 2000
  `);
  const linkedSet = new Set(
    linked.filter((l) => l.ref_table !== "cash_txn").map((l) => `${l.ref_table}|${l.ref_id}`),
  );
  // 통장 줄은 부분 연결이 가능 (카랑 한 입금 = 현대캐피탈+쏘카 계산서) — 남은 금액을 계산
  const cashLinked = new Map<number, number>();
  for (const l of linked) {
    if (l.ref_table === "cash_txn") {
      cashLinked.set(Number(l.ref_id), (cashLinked.get(Number(l.ref_id)) ?? 0) + Number(l.amount));
    }
  }
  const freePurchases = purchases.filter((p) => Number(p.total) > 0 && !linkedSet.has(`purchase_invoice|${p.id}`));
  const freeQuotes = quotes.filter((q) => !linkedSet.has(`quote|${q.id}`));

  // ⑦ 통장 입금 후보 (매출 계산서 ↔ 입금 직접 연결)
  const deposits = await db.execute<{ id: number; date: string; description: string; in_amount: number; l: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           description, in_amount, account_label l
    FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0 AND category IS NULL
      AND recon_status <> '확정' -- 🔴 감사 H7: 외상 수금 등으로 이미 정리된 입금은 후보에서 뺀다
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${TAX_APP_START}::date
    ORDER BY id DESC LIMIT 400
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
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${TAX_APP_START}::date
    ORDER BY id DESC LIMIT 400
  `);
  const freeWithdrawals = withdrawals
    .map((x) => ({ ...x, remain: Number(x.out_amount) - (cashLinked.get(Number(x.id)) ?? 0) }))
    .filter((x) => x.remain > 0);

  const norm = normName;

  /* 직접 검색 풀 (사장님 제보 2026-08-25 — 선입금·적립은 금액이 아예 달라 후보에 못 뜬다.
   *  거래처 검색하듯 통장 줄을 찾아 잇게 한다. 부분 연결 덕에 「적립 소진」도 그대로 담긴다) */
  const payerOf = (desc: string) => desc.replace(/^\[[^\]]*\]\s*/, "").trim();
  const toPick = (x: { id: number; date: string; description: string; l: string; remain: number }, sign: string): BankPick => ({
    id: Number(x.id),
    date: x.date,
    payer: payerOf(x.description),
    remain: x.remain,
    label: `${x.date.slice(5)} · ${x.description.slice(0, 26)} · ${sign}${won(x.remain)}원 (${x.l})`,
  });
  const bankPool = {
    in: freeDeposits.slice(0, 200).map((x) => toPick(x, "+")),
    out: freeWithdrawals.slice(0, 200).map((x) => toPick(x, "−")),
  };

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
      const buyBank = freeWithdrawals
        .map((x) => {
          const payer = x.description.replace(/^\[[^\]]*\]\s*/, "").trim();
          const known = aliasMap.has(`${norm(payer)}@${inv.counterBizNo}`);
          return { x, known, exact: x.remain === inv.total };
        })
        .filter(({ x, known, exact }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          const inWindow = t >= w - 7 * 86400000 && t <= w + (known ? 150 : 90) * 86400000;
          return inWindow && (exact || known); // 기억된 지급처는 차액이 있어도 보여준다
        })
        .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.known) - Number(a.known))
        .slice(0, 4)
        .map(({ x, known, exact }) => ({
          id: Number(x.id),
          label:
            `${known ? "★ " : ""}${x.date.slice(5)} · ${x.description.slice(0, 24)} · −${won(x.remain)}원 (${x.l})` +
            (exact ? "" : ` · 차액 ${won(x.remain - inv.total)}원`),
          amount: x.remain,
          date: x.date,
        }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : near,
        bankCands: buyBank,
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
      const bankCands = freeDeposits
        .map((x) => {
          const payer = x.description.replace(/^\[[^\]]*\]\s*/, "").trim();
          const known = aliasMap.has(`${norm(payer)}@${inv.counterBizNo}`);
          return { x, known, exact: x.remain === inv.total };
        })
        .filter(({ x, known, exact }) => {
          const t = new Date(x.date).getTime();
          const w = new Date(inv.writeDate).getTime();
          const inWindow = t >= w - 7 * 86400000 && t <= w + (known ? 120 : 60) * 86400000;
          return inWindow && (exact || known || partyKind === "대행정산");
        })
        .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.known) - Number(a.known))
        .slice(0, 4)
        .map(({ x, known, exact }) => ({
          id: Number(x.id),
          label:
            `${known ? "★ " : ""}${x.date.slice(5)} · ${x.description.slice(0, 24)} · +${won(x.remain)}원 (${x.l})` +
            (exact ? "" : ` · 차액 ${won(x.remain - inv.total)}원`),
          amount: x.remain,
          date: x.date,
        }));
      suggestions.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : candidates,
        bankCands,
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
    bankPool,
    openCount: suggestions.length,
    autoCount: suggestions.filter((s) => s.auto).length,
    doneCount: counts.find((c) => c.s === "확정")?.n ?? 0,
    ignoredCount: counts.find((c) => c.s === "무시")?.n ?? 0,
    pastCount: Number(past[0]?.n ?? 0),
    pastSum: Number(past[0]?.s ?? 0),
    reasonCounts: reasons.map((r) => ({ reason: r.reason, n: Number(r.n) })),
    supplierOptions: suppliers.map((s) => ({ id: Number(s.id), name: s.name })),
  };
}
