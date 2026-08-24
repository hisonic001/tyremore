/**
 * ⭐ 세금계산서 대조 — 후보 계산 (ERP 2단계, 2026-08-24)
 *
 *   미대조 세금계산서마다 「어느 매입/판매와 같은 건인가」 후보를 만든다.
 *   원칙(계획서): 자동확정 = ①상대 식별 확실 ②금액 정확 일치 ③후보 유일 — 셋 다일 때만.
 *   그 외는 전부 '제안'으로 사람이 확정한다 (MARS 에서 배운 「확실하지 않으면 사람에게」).
 *
 * 🔴 "use server" 아님 — 화면(페이지)이 권한 확인 후 부르고, 확정은 recon.ts 가 한다.
 * 🔴 질의 순차 · LIMIT — 자료가 작아(월 수십 건) JS 에서 맞춘다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/㈜|\(주\)|주식회사|\s/g, "")
    .toLowerCase();

/** ⭐ 별명 사전이 쓰는 이름 정규화 — 학습(recon·fin-deposits)과 조회가 같은 규칙 */
export const normName = norm;

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
}

export interface CandidateRef {
  table: "purchase_invoice" | "quote";
  id: number;
  /** 화면에 보일 한 줄 — 「INV123 · 미쉐린 · 5,261,454원 (08-12)」 */
  label: string;
  date: string | null;
  amount: number;
}

export interface TaxSuggestion {
  inv: TaxRow;
  /** 자동확정 가능 — 정확 일치 + 후보 유일 */
  auto: CandidateRef | null;
  /** 같은 달 묶음 — 합계가 계산서와 정확히 일치 */
  bundle: CandidateRef[] | null;
  /** 그 외 후보 (사람이 골라 확정) */
  candidates: CandidateRef[];
  /** biz_no 로 이어졌거나 이름으로 짐작한 거래처 */
  supplierId: number | null;
  supplierName: string | null;
  /** 확정할 때 이 거래처에 사업자번호를 기억시킬 수 있다 */
  learnable: boolean;
}

export interface TaxReconData {
  open: TaxSuggestion[];
  autoCount: number;
  doneCount: number;
  ignoredCount: number;
  /** 거래처 직접 지정용 — 이름이 아예 달라 못 찾을 때 (사장님 제보 2026-08-25) */
  supplierOptions: { id: number; name: string }[];
}

const won = (n: number) => n.toLocaleString("ko-KR");
const sameMonth = (a: string | null, b: string) => !!a && a.slice(0, 7) === b.slice(0, 7);
const dayDiff = (a: string | null, b: string): number =>
  a ? Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) : 999;

export async function taxReconData(): Promise<TaxReconData> {
  // ① 열린 세금계산서 (순차)
  const invs = await db.execute<{
    id: number; direction: "매출" | "매입"; approval_no: string; write_date: string;
    counterparty_biz_no: string; counterparty_name: string;
    supply_amount: number; vat: number; total: number; item_summary: string | null; recon_status: string;
  }>(sql`
    SELECT id, direction, approval_no, to_char(write_date, 'YYYY-MM-DD') write_date,
           counterparty_biz_no, counterparty_name, supply_amount, vat, total, item_summary, recon_status
    FROM tax_invoice
    WHERE is_active AND recon_status IN ('미대조', '제안')
    ORDER BY write_date DESC, id DESC LIMIT 120
  `);

  const counts = await db.execute<{ s: string; n: number }>(sql`
    SELECT recon_status s, count(*)::int n FROM tax_invoice WHERE is_active GROUP BY 1 LIMIT 5
  `);
  const doneCount = counts.find((c) => c.s === "확정")?.n ?? 0;
  const ignoredCount = counts.find((c) => c.s === "무시")?.n ?? 0;

  // ② 거래처 (biz_no 학습 사전)
  const suppliers = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 200
  `);

  // ⭐ 이름 별명 사전 (사장님 요청 2026-08-24) — 한 번 이어준 상호는 확실한 상대로 본다
  const aliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias LIMIT 500
  `);
  const aliasMap = new Map(aliases.map((a) => [a.alias_key, a.party_key]));

  // ③ 매입 인보이스 (앱의 매입 기록)
  const purchases = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number | null;
  }>(sql`
    SELECT id, supplier, invoice_no,
           COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d,
           total
    FROM purchase_invoice WHERE status <> '취소' ORDER BY id DESC LIMIT 300
  `);

  // ④ 거래처 판매 (매출 계산서의 상대)
  const quotes = await db.execute<{ id: number; quote_no: string; supplier_name: string; d: string; total: number }>(sql`
    SELECT id, quote_no, supplier_name, to_char(COALESCE(work_date, created_at::date), 'YYYY-MM-DD') d,
           total_amount total
    FROM quote WHERE status = '성사' AND supplier_name IS NOT NULL
    ORDER BY id DESC LIMIT 400
  `);

  // ⑤ 이미 연결된 것 — 같은 매입/판매를 두 계산서에 잇지 않는다
  const linked = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    SELECT ref_table, ref_id FROM recon_match
    WHERE kind IN ('매입계산서', '매출계산서') LIMIT 1000
  `);
  const linkedSet = new Set(linked.map((l) => `${l.ref_table}|${l.ref_id}`));
  // 0원·금액 없는 수기 매입은 후보에서 뺀다 — 이어 봐야 맞을 수 없다
  const freePurchases = purchases.filter((p) => Number(p.total) > 0 && !linkedSet.has(`purchase_invoice|${p.id}`));
  const freeQuotes = quotes.filter((q) => !linkedSet.has(`quote|${q.id}`));

  const open: TaxSuggestion[] = [];
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
    };

    if (inv.direction === "매입") {
      // 거래처 찾기 — ① 사업자번호 학습분 ② 이름 유사
      const byBiz = suppliers.find((s) => s.biz_no && s.biz_no.replace(/\D/g, "") === inv.counterBizNo);
      // 별명 사전 — 사장님이 전에 이 상호를 어느 거래처로 이었는지
      const aliasParty = aliasMap.get(norm(inv.counterName)) ?? null;
      const byAlias = aliasParty?.startsWith("S:")
        ? (suppliers.find((s) => s.name === aliasParty.slice(2)) ?? null)
        : null;
      const byName =
        byBiz ??
        byAlias ??
        suppliers.find((s) => {
          const a = norm(s.name);
          const b = norm(inv.counterName);
          return a.length >= 2 && (b.includes(a) || a.includes(b));
        }) ??
        null;
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
      // 자동확정은 사업자번호로 **확실히** 이어진 거래처일 때만 (이름 짐작만으로는 제안까지)
      const auto = (byBiz ?? byAlias) && exact.length === 1 ? toRef(exact[0]) : null;

      const monthPool = pool.filter((p) => sameMonth(p.d, inv.writeDate));
      const monthSum = monthPool.reduce((s, p) => s + Number(p.total), 0);
      const bundle = !auto && monthPool.length > 1 && monthSum === inv.total ? monthPool.map(toRef) : null;

      const near = pool
        .filter((p) => sameMonth(p.d, inv.writeDate) || Math.abs(Number(p.total) - inv.total) <= Math.max(1000, inv.total * 0.01))
        .slice(0, 6)
        .map(toRef);

      open.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : near,
        supplierId: sup ? Number(sup.id) : null,
        supplierName: sup?.name ?? null,
        learnable: !!sup && !sup.biz_no,
      });
    } else {
      // 매출 — 상대 = 거래처 판매 (supplier_name)
      const aliasSell = aliasMap.get(norm(inv.counterName)) ?? null;
      const aliasName = aliasSell?.startsWith("S:") ? aliasSell.slice(2) : null;
      const pool = freeQuotes.filter((q) => {
        if (aliasName && q.supplier_name === aliasName) return true;
        const a = norm(q.supplier_name);
        const b = norm(inv.counterName);
        return a.length >= 2 && (b.includes(a) || a.includes(b));
      });
      const toRef = (q: (typeof pool)[number]): CandidateRef => ({
        table: "quote",
        id: Number(q.id),
        label: `${q.quote_no} · ${q.supplier_name} · ${won(Number(q.total))}원 (${q.d.slice(5)})`,
        date: q.d,
        amount: Number(q.total),
      });
      const exact = pool.filter((q) => Number(q.total) === inv.total && sameMonth(q.d, inv.writeDate));
      // 매출 자동확정: 이름이 이어진 거래처 판매 + 금액 정확 + 유일
      const auto = exact.length === 1 ? toRef(exact[0]) : null;
      const monthPool = pool.filter((q) => sameMonth(q.d, inv.writeDate));
      const monthSum = monthPool.reduce((s, q) => s + Number(q.total), 0);
      const bundle = !auto && monthPool.length > 1 && monthSum === inv.total ? monthPool.map(toRef) : null;
      open.push({
        inv,
        auto,
        bundle,
        candidates: auto ? [] : monthPool.slice(0, 6).map(toRef),
        supplierId: null,
        supplierName: pool[0]?.supplier_name ?? null,
        learnable: false,
      });
    }
  }

  return {
    open,
    autoCount: open.filter((s) => s.auto).length,
    doneCount,
    ignoredCount,
    supplierOptions: suppliers.map((s) => ({ id: Number(s.id), name: s.name })),
  };
}

/* ================================================================== */
/* ERP 4단계 — 통장 입금 대조 (2026-08-24)                              */

export interface DepositRow {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  at: string;
  amount: number;
  description: string;
  /** 「[적요] 내용」에서 뽑은 입금자명 어림 */
  payerName: string;
  label: string;
}

export interface DepositQuoteRef {
  quoteId: number;
  label: string;
  amount: number;
  date: string;
}

export interface DepositPartyRef {
  /** receivable-book 의 대상 열쇠 — 'S:금호' · 'C:123' */
  key: string;
  label: string;
  remain: number;
  count: number;
}

export interface DepositSuggestion {
  dep: DepositRow;
  /** 같은 금액·±3일의 계좌이체 판매 — 항상 제안(자동확정 없음, 동명 금액 위험) */
  quotes: DepositQuoteRef[];
  /** 입금자명과 이름이 닮은 외상 대상 — [수금 등록]으로 바로 턴다 */
  parties: DepositPartyRef[];
}

export interface DepositReconData {
  open: DepositSuggestion[];
  /** 적요 패턴(FB자금·매출표)으로 카드 정산으로 보이는 미대조 입금 */
  cardPatternCount: number;
  cardPatternSum: number;
  doneCount: number;
  ignoredCount: number;
}

export async function depositReconData(ym: string): Promise<DepositReconData> {
  const start = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + 1;
  const nextStart = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
  const inMonth = sql`source = '통장' AND is_active AND in_amount > 0
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;
  // 카드 정산 두 얼굴: 적요 FB자금·매출표 + 카드사 코드형 입금자명(KB1169…·NH1752…) — 실측 2026-08-24
  const CARD_PAT = sql`(description LIKE '%FB자금%' OR description LIKE '%매출표%' OR description ~ '\] ?(KB|NH|하나|현|우|삼성|롯데|신한|비씨|BC|SHC)[0-9]')`;

  // ① 이 달 미대조 입금 (카드 정산 패턴은 따로 묶는다)
  const deps = await db.execute<{
    id: number; date: string; at: string; in_amount: number; description: string; l: string;
  }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           in_amount, description, account_label l
    FROM cash_txn
    WHERE ${inMonth} AND recon_status = '미대조' AND category IS NULL AND NOT ${CARD_PAT}
    ORDER BY occurred_at DESC, id DESC LIMIT 60
  `);

  const pat = await db.execute<{ n: number; s: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND recon_status = '미대조' AND ${CARD_PAT}
  `);

  const counts = await db.execute<{ st: string; n: number }>(sql`
    SELECT recon_status st, count(*)::int n FROM cash_txn WHERE ${inMonth} GROUP BY 1 LIMIT 5
  `);

  // ② 이을 만한 계좌이체 판매 (±3일 여유)
  const startPad = new Date(new Date(start + "T00:00:00").getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const endPad = new Date(new Date(nextStart + "T00:00:00").getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const transfers = await db.execute<{
    id: number; quote_no: string; total: number; d: string; who: string; plate_no: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           COALESCE(q.supplier_name, c.name, '손님') who, v.plate_no
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN vehicle  v ON v.id = q.vehicle_id
    WHERE q.status = '성사' AND q.payment_method = '계좌이체' AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${startPad}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${endPad}::date
    ORDER BY q.id DESC LIMIT 200
  `);

  // ③ 이미 이은 판매는 후보에서 뺀다
  const linked = await db.execute<{ ref_id: number }>(sql`
    SELECT ref_id FROM recon_match WHERE kind = '이체입금' AND ref_table = 'quote' LIMIT 1000
  `);
  const linkedQ = new Set(linked.map((l) => Number(l.ref_id)));
  const freeTransfers = transfers.filter((q) => !linkedQ.has(Number(q.id)));

  // ④ 외상 대상 (잔액 있는 것만) — receivable-book 과 같은 정의를 그 모듈로 얻는다
  const { receivableBook } = await import("./receivable-book");
  const book = await receivableBook();

  // ⭐ 별명 사전 — 입금자명을 한 번 이어주면 다음부터 바로 알아본다
  const aliases2 = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias LIMIT 500
  `);
  const aliasMap = new Map(aliases2.map((a) => [a.alias_key, a.party_key]));

  const dayDiff3 = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) <= 3;

  const open: DepositSuggestion[] = deps.map((r) => {
    // 「[적요] 내용」 → 내용 부분이 대개 입금자명이다
    const payerName = r.description.replace(/^\[[^\]]*\]\s*/, "").trim();
    const pn = norm(payerName);
    const quotes = freeTransfers
      .filter((q) => Number(q.total) === Number(r.in_amount) && dayDiff3(q.d, r.date))
      .slice(0, 5)
      .map((q) => ({
        quoteId: Number(q.id),
        label: `${q.quote_no} · ${q.who}${q.plate_no ? ` ${q.plate_no}` : ""} · ${Number(q.total).toLocaleString()}원 (${q.d.slice(5)})`,
        amount: Number(q.total),
        date: q.d,
      }));
    const aliasParty = aliasMap.get(pn) ?? null;
    const aliasTarget = aliasParty ? (book.targets.find((tg) => tg.key === aliasParty) ?? null) : null;
    const parties = [
      ...(aliasTarget ? [aliasTarget] : []),
      ...book.targets.filter((tg) => {
        if (aliasTarget && tg.key === aliasTarget.key) return false;
        const a = norm(tg.label.replace(/^거래처\s*/, ""));
        return pn.length >= 2 && a.length >= 2 && (a.includes(pn) || pn.includes(a));
      }),
    ]
      .slice(0, 3)
      .map((tg) => ({ key: tg.key, label: tg.label, remain: tg.remain, count: tg.count }));
    return {
      dep: {
        id: Number(r.id),
        date: r.date,
        at: r.at,
        amount: Number(r.in_amount),
        description: r.description,
        payerName,
        label: r.l,
      },
      quotes,
      parties,
    };
  });

  return {
    open,
    cardPatternCount: Number(pat[0]?.n ?? 0),
    cardPatternSum: Number(pat[0]?.s ?? 0),
    doneCount: counts.find((c) => c.st === "확정")?.n ?? 0,
    ignoredCount: counts.find((c) => c.st === "무시")?.n ?? 0,
  };
}

/* ================================================================== */
/* ERP ⑥ 경비 분류 (사장님 지시 2026-08-25)                             */

// 🔴 분류 상수는 expense-cats.ts (순수 모듈) — 클라이언트 화면이 값으로 쓰기 때문
//    (여기서 내보내면 DB 모듈이 브라우저 번들에 끌려가 빌드가 깨진다, 2026-08-25 실사고)
import { payerKeyOf } from "./expense-cats";
export { payerKeyOf };

export interface ExpenseRow {
  id: number;
  source: string;
  label: string;
  at: string;
  amount: number;
  payer: string;
  description: string;
  category: string | null;
  /** 규칙 사전이 제안하는 분류 */
  suggest: string | null;
}

export interface ExpenseData {
  /** 분류 안 된 지출 (통장 출금 + 법인카드) — 금액 큰 것부터 */
  unclassified: ExpenseRow[];
  unclassifiedSum: number;
  unclassifiedTotal: number;
  /** 이 달 분류별 지출 합 */
  sums: { category: string; amount: number; n: number }[];
}

export async function expenseData(ym: string): Promise<ExpenseData> {
  const start = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + 1;
  const nextStart = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
  const inMonth = sql`is_active AND out_amount > 0
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  const rules = await db.execute<{ key: string; category: string }>(sql`
    SELECT key, category FROM expense_rule LIMIT 1000
  `);
  const ruleMap = new Map(rules.map((r) => [r.key, r.category]));

  const rows = await db.execute<{
    id: number; source: string; l: string; at: string; out_amount: number; description: string;
  }>(sql`
    SELECT id, source, account_label l,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           out_amount, description
    FROM cash_txn
    WHERE ${inMonth} AND category IS NULL
    ORDER BY out_amount DESC, id DESC LIMIT 80
  `);
  const totalRow = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s, count(*)::int n FROM cash_txn
    WHERE ${inMonth} AND category IS NULL
  `);
  const sums = await db.execute<{ category: string; s: string; n: number }>(sql`
    SELECT category, COALESCE(SUM(out_amount), 0)::bigint s, count(*)::int n
    FROM cash_txn WHERE ${inMonth} AND category IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20
  `);

  const unclassified = rows.map((r) => {
    const payer = payerKeyOf(r.source, r.description);
    return {
      id: Number(r.id),
      source: r.source,
      label: r.l,
      at: r.at,
      amount: Number(r.out_amount),
      payer,
      description: r.description,
      category: null,
      suggest: ruleMap.get(payer) ?? null,
    };
  });

  return {
    unclassified,
    unclassifiedSum: unclassified.reduce((s, r) => s + r.amount, 0),
    unclassifiedTotal: Number(totalRow[0]?.s ?? 0),
    sums: sums.map((r) => ({ category: r.category, amount: Number(r.s), n: Number(r.n) })),
  };
}

/* ================================================================== */
/* ERP ⑦ 미지급금 (사장님 지시 2026-08-25)                              */

export interface PayableInvoice {
  invoiceId: number;
  invoiceNo: string;
  d: string | null;
  total: number;
  paid: number;
  remain: number;
}

export interface PayableSupplier {
  supplier: string;
  count: number;
  total: number;
  paid: number;
  remain: number;
  oldestD: string | null;
  invoices: PayableInvoice[];
}

export interface PayablesData {
  suppliers: PayableSupplier[];
  totalRemain: number;
  /** 최근 지급 — 잘못 넣었으면 지운다 */
  recent: { id: number; supplier: string; invoiceNo: string; amount: number; method: string; paidOn: string }[];
}

/** 거래처별 미지급 장부 — 외상 장부(receivable-book)의 거울상 */
export async function payablesData(): Promise<PayablesData> {
  const rows = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number; paid: string;
  }>(sql`
    SELECT pi.id, pi.supplier, pi.invoice_no,
           COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d,
           pi.total,
           COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
    FROM purchase_invoice pi
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > 0
    ORDER BY d ASC, pi.id ASC LIMIT 400
  `);

  const bySup = new Map<string, PayableSupplier>();
  for (const r of rows) {
    const total = Number(r.total);
    const paid = Number(r.paid);
    const remain = total - paid;
    let s = bySup.get(r.supplier);
    if (!s) {
      s = { supplier: r.supplier, count: 0, total: 0, paid: 0, remain: 0, oldestD: null, invoices: [] };
      bySup.set(r.supplier, s);
    }
    s.count++;
    s.total += total;
    s.paid += paid;
    s.remain += remain;
    if (remain > 0) {
      if (!s.oldestD) s.oldestD = r.d;
      if (s.invoices.length < 30) {
        s.invoices.push({
          invoiceId: Number(r.id),
          invoiceNo: r.invoice_no,
          d: r.d,
          total,
          paid,
          remain,
        });
      }
    }
  }
  const suppliers = [...bySup.values()].filter((s) => s.remain > 0).sort((a, b) => b.remain - a.remain);

  const recent = await db.execute<{
    id: number; supplier: string; invoice_no: string; amount: number; method: string; paid_on: string;
  }>(sql`
    SELECT pp.id, pi.supplier, pi.invoice_no, pp.amount, pp.method, to_char(pp.paid_on, 'YYYY-MM-DD') paid_on
    FROM purchase_payment pp JOIN purchase_invoice pi ON pi.id = pp.invoice_id
    ORDER BY pp.id DESC LIMIT 15
  `);

  return {
    suppliers,
    totalRemain: suppliers.reduce((s, x) => s + x.remain, 0),
    recent: recent.map((r) => ({
      id: Number(r.id),
      supplier: r.supplier,
      invoiceNo: r.invoice_no,
      amount: Number(r.amount),
      method: r.method,
      paidOn: r.paid_on,
    })),
  };
}
