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
import { CARD_SETTLE_PATTERN_SQL } from "./expense-cats";

const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/㈜|\(주\)|주식회사|\s/g, "")
    .toLowerCase();

/** ⭐ 별명 사전이 쓰는 이름 정규화 — 학습(recon·fin-deposits)과 조회가 같은 규칙 */
export const normName = norm;

/* 🔴 감사 M2(2026-08-25): v1 taxReconData 170줄(죽은 코드) 삭제 — 정본은 tax-recon.ts */

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
  /** 기억된 정산 입금자(세금계산서 상대) — 「이관우 = 한국타이어 정산」 안내 */
  taxHint: string | null;
}

export interface DepositReconData {
  open: DepositSuggestion[];
  /** 카드정산으로 표시된 입금(이 달) — 잘못 표시했으면 되돌린다 (감사 H10) */
  settledCard: { id: number; at: string; amount: number; payer: string }[];
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
  // 카드 정산 패턴 — 정본은 expense-cats.CARD_SETTLE_PATTERN_SQL (감사 L1)
  const CARD_PAT = sql.raw(CARD_SETTLE_PATTERN_SQL);

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
  const startPad = new Date(new Date(start + "T00:00:00Z").getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const endPad = new Date(new Date(nextStart + "T00:00:00Z").getTime() + 3 * 86400000).toISOString().slice(0, 10);
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
  const aliases2 = await db.execute<{ alias_key: string; party_key: string; party_label: string }>(sql`
    SELECT alias_key, party_key, party_label FROM party_alias LIMIT 500
  `);
  const aliasMap = new Map(aliases2.map((a) => [a.alias_key, a.party_key]));
  const aliasLabel = new Map(aliases2.map((a) => [a.alias_key, a.party_label]));

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
    // 한 입금자가 여러 계산서 상대로 기억될 수 있다 (카랑 → 현대캐피탈·쏘카)
    const tLabels = [
      ...new Set(
        aliases2
          .filter((a) => a.party_key.startsWith("T:") && (a.alias_key === pn || a.alias_key.startsWith(pn + "@")))
          .map((a) => a.party_label),
      ),
    ];
    const taxHint = tLabels.length > 0 ? tLabels.join(" · ") : null;
    const aliasTarget =
      aliasParty && !aliasParty.startsWith("T:") ? (book.targets.find((tg) => tg.key === aliasParty) ?? null) : null;
    const parties = [
      ...(aliasTarget ? [aliasTarget] : []),
      ...book.targets.filter((tg) => {
        if (tg.kind === "walkin") return false; // 🔴 감사 L13: 비회원은 수금 등록이 안 되는 대상 — 후보에서 뺀다
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
      taxHint,
    };
  });

  const settledCardRows = await db.execute<{ id: number; at: string; in_amount: number; description: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, in_amount, description
    FROM cash_txn WHERE ${inMonth} AND category = '카드정산'
    ORDER BY occurred_at DESC LIMIT 40
  `);

  return {
    open,
    settledCard: settledCardRows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      amount: Number(r.in_amount),
      payer: r.description.replace(/^\[[^\]]*\]\s*/, "").trim(),
    })),
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
  /** 분류된 지출(이 달) — 잘못 붙였으면 해제 (감사 H10 계열) */
  classified: ExpenseRow[];
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

  const classifiedRows = await db.execute<{
    id: number; source: string; l: string; at: string; out_amount: number; description: string; category: string;
  }>(sql`
    SELECT id, source, account_label l,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           out_amount, description, category
    FROM cash_txn
    WHERE ${inMonth} AND category IS NOT NULL
    ORDER BY occurred_at DESC LIMIT 40
  `);
  const classified = classifiedRows.map((r) => ({
    id: Number(r.id),
    source: r.source,
    label: r.l,
    at: r.at,
    amount: Number(r.out_amount),
    payer: payerKeyOf(r.source, r.description),
    description: r.description,
    category: r.category,
    suggest: null,
  }));

  return {
    unclassified,
    classified,
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
