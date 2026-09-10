/**
 * ⭐ 렌트카 거래처 월 정산 — 조회 (사장님 요청 2026-09-01)
 *
 * 🔴 "use server" 아님 — 읽기 전용. 쓰기는 settlement.ts.
 * 🔴 그 달 외상 모집단은 외상 장부 정본과 같다:
 *    status='성사' AND payment_method='외상' AND supplier_name=X (receivable-book.ts)
 * 🔴 질의는 하나씩 차례로 (2026-08-11 마비 사고) — Promise.all 금지.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange } from "./ym";

export interface SettleRunSummary {
  id: number;
  supplierName: string;
  ym: string;
  status: string;
  invoicedAmount: number | null;
  agreedAmount: number | null;
  depositedOn: string | null;
  depositedAmount: number | null;
  lineCount: number;
  /** 지금 남은 외상 잔액 (취소 제외, 파생) */
  remain: number;
}

/** 관리대장 — 회차 목록 (수기 「청구·입금 관리대장」 자리) */
export async function settlementBook(): Promise<SettleRunSummary[]> {
  const rows = await db.execute<{
    id: number;
    supplier_name: string;
    ym: string;
    status: string;
    invoiced_amount: number | null;
    agreed_amount: number | null;
    deposited_on: string | null;
    deposited_amount: number | null;
    n: number;
    remain: string;
  }>(sql`
    SELECT r.id, r.supplier_name, r.ym, r.status, r.invoiced_amount, r.agreed_amount,
           r.deposited_on::text deposited_on, r.deposited_amount,
           count(l.id)::int n,
           COALESCE(SUM(CASE WHEN q.status = '성사' AND q.payment_method = '외상'
             THEN q.total_amount - COALESCE(rp.paid, 0) ELSE 0 END), 0)::bigint remain
    FROM settlement_run r
    LEFT JOIN settlement_line l ON l.run_id = r.id
    LEFT JOIN quote q ON q.id = l.quote_id
    LEFT JOIN (SELECT quote_id, SUM(amount)::int paid FROM receivable_payment GROUP BY 1) rp
      ON rp.quote_id = q.id
    GROUP BY r.id
    ORDER BY r.ym DESC, r.supplier_name ASC
    LIMIT 120
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    supplierName: r.supplier_name,
    ym: r.ym,
    status: r.status,
    invoicedAmount: r.invoiced_amount === null ? null : Number(r.invoiced_amount),
    agreedAmount: r.agreed_amount === null ? null : Number(r.agreed_amount),
    depositedOn: r.deposited_on,
    depositedAmount: r.deposited_amount === null ? null : Number(r.deposited_amount),
    lineCount: Number(r.n),
    remain: Number(r.remain),
  }));
}

/* ============================================================
 * ⭐ 관리대장 시트 자료 (사장님 요청 2026-09-10)
 *
 *   수기 「렌트카_거래처_청구입금_관리대장.xlsx」 의 「거래내역」 시트와 같은 줄:
 *   No. / 청구일 / 거래처 / 내용 / 청구금액 / 입금일 / 입금금액 / 미수금 / 상태 / 비고
 *
 * 🔴 청구금액은 **합의액이 있으면 합의액** — 수기 대장에 적어 오신 것도 거래처와
 *    맞춘 뒤 실제로 청구한 금액이다 (합의 전이면 청구서 스냅샷).
 * ========================================================== */
export interface SettleLedgerRow {
  supplierName: string;
  ym: string;
  /** 청구일 = 청구서를 내보낸 날 (아직이면 null) */
  billedOn: string | null;
  billed: number | null;
  depositedOn: string | null;
  deposited: number | null;
  status: string;
  memo: string | null;
}

export async function settlementLedger(limit = 200): Promise<SettleLedgerRow[]> {
  const rows = await db.execute<{
    supplier_name: string;
    ym: string;
    billed_on: string | null;
    billed: number | null;
    deposited_on: string | null;
    deposited_amount: number | null;
    status: string;
    memo: string | null;
  }>(sql`
    SELECT r.supplier_name, r.ym,
           (r.invoice_exported_at AT TIME ZONE 'Asia/Seoul')::date::text billed_on,
           COALESCE(r.agreed_amount, r.invoiced_amount) billed,
           r.deposited_on::text deposited_on, r.deposited_amount, r.status, r.memo
    FROM settlement_run r
    ORDER BY r.ym ASC, r.supplier_name ASC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    supplierName: r.supplier_name,
    ym: r.ym,
    billedOn: r.billed_on,
    billed: r.billed === null ? null : Number(r.billed),
    depositedOn: r.deposited_on,
    deposited: r.deposited_amount === null ? null : Number(r.deposited_amount),
    status: r.status,
    memo: r.memo,
  }));
}

export interface SettleItem {
  id: number;
  description: string;
  qty: number;
  price: number;
  lineType: string;
}

export interface SettleInstruction {
  quoteItemId: number | null;
  description: string;
  qty: number;
  originalPrice: number;
  action: string;
  agreedPrice: number | null;
}

export interface SettleLineView {
  lineId: number;
  quoteId: number;
  quoteNo: string;
  workDate: string;
  plateNo: string | null;
  model: string | null;
  billed: number;
  decision: string;
  agreed: number | null;
  replyMemo: string | null;
  matchedBy: string | null;
  applied: boolean;
  /** 지금 판매의 상태·금액 (스냅샷과 다르면 화면이 경고한다) */
  currentStatus: string;
  currentTotal: number;
  paid: number;
  items: SettleItem[];
  /** 저장돼 있는 줄 단위 지시·기록 */
  instructions: SettleInstruction[];
}

export interface SettleView {
  run: {
    id: number;
    status: string;
    invoicedAmount: number | null;
    invoiceExportedAt: string | null;
    agreedAmount: number | null;
    depositedOn: string | null;
    depositedAmount: number | null;
    memo: string | null;
  } | null;
  supplier: string;
  ym: string;
  vatMode: "포함" | "별도";
  lines: SettleLineView[];
  /** run 이 없을 때 — 그 달 외상 판매 (정산 시작 전 미리보기) */
  monthCount: number;
  monthTotal: number;
  /** run 이 있는데 그 뒤 등록된 그 달 판매 (담기 제안) */
  newSalesCount: number;
}

export async function settlementView(supplier: string, ym: string): Promise<SettleView> {
  const { start, nextStart } = monthRange(ym);
  const [sup] = await db.execute<{ vat_mode: string }>(sql`
    SELECT vat_mode FROM supplier WHERE name = ${supplier} LIMIT 1
  `);
  const vatMode = (sup?.vat_mode === "별도" ? "별도" : "포함") as "포함" | "별도";

  const [run] = await db.execute<{
    id: number;
    status: string;
    invoiced_amount: number | null;
    invoice_exported_at: string | null;
    agreed_amount: number | null;
    deposited_on: string | null;
    deposited_amount: number | null;
    memo: string | null;
  }>(sql`
    SELECT id, status, invoiced_amount,
           to_char(invoice_exported_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') invoice_exported_at,
           agreed_amount, deposited_on::text deposited_on, deposited_amount, memo
    FROM settlement_run WHERE supplier_name = ${supplier} AND ym = ${ym} LIMIT 1
  `);

  /** 그 달 외상 모집단 (정본 규칙) — run 유무와 무관하게 센다 */
  const [month] = await db.execute<{ n: number; total: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(total_amount), 0)::bigint total
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.supplier_name = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
  `);

  if (!run) {
    return {
      run: null,
      supplier,
      ym,
      vatMode,
      lines: [],
      monthCount: Number(month.n),
      monthTotal: Number(month.total),
      newSalesCount: 0,
    };
  }

  const lines = await db.execute<{
    line_id: number;
    quote_id: number;
    quote_no: string;
    work_date: string;
    plate_no: string | null;
    model: string | null;
    billed_amount: number;
    decision: string;
    agreed_amount: number | null;
    reply_memo: string | null;
    matched_by: string | null;
    applied_at: string | null;
    q_status: string;
    q_total: number;
    paid: number;
  }>(sql`
    SELECT l.id line_id, l.quote_id, q.quote_no,
           COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)::text work_date,
           v.plate_no, v.model,
           l.billed_amount, l.decision, l.agreed_amount, l.reply_memo, l.matched_by,
           l.applied_at::text applied_at,
           q.status q_status, q.total_amount q_total,
           COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid
    FROM settlement_line l
    JOIN quote q ON q.id = l.quote_id
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE l.run_id = ${run.id}
    ORDER BY work_date ASC, q.id ASC
    LIMIT 300
  `);

  const items = await db.execute<{
    quote_id: number;
    id: number;
    description: string;
    qty: number;
    final_price: number;
    line_type: string;
  }>(sql`
    SELECT i.quote_id, i.id, i.description, i.qty, i.final_price, i.line_type
    FROM quote_item i
    WHERE i.quote_id IN (SELECT quote_id FROM settlement_line WHERE run_id = ${run.id})
    ORDER BY i.quote_id, i.id
    LIMIT 2000
  `);
  const itemsBy = new Map<number, SettleItem[]>();
  for (const it of items) {
    const list = itemsBy.get(Number(it.quote_id)) ?? [];
    list.push({
      id: Number(it.id),
      description: it.description,
      qty: Number(it.qty),
      price: Number(it.final_price),
      lineType: it.line_type,
    });
    itemsBy.set(Number(it.quote_id), list);
  }

  const instr = await db.execute<{
    line_id: number;
    quote_item_id: number | null;
    description: string;
    qty: number;
    original_price: number;
    action: string;
    agreed_price: number | null;
  }>(sql`
    SELECT li.line_id, li.quote_item_id, li.description, li.qty, li.original_price, li.action, li.agreed_price
    FROM settlement_line_item li
    WHERE li.line_id IN (SELECT id FROM settlement_line WHERE run_id = ${run.id})
    ORDER BY li.id
    LIMIT 2000
  `);
  const instrBy = new Map<number, SettleInstruction[]>();
  for (const r of instr) {
    const list = instrBy.get(Number(r.line_id)) ?? [];
    list.push({
      quoteItemId: r.quote_item_id === null ? null : Number(r.quote_item_id),
      description: r.description,
      qty: Number(r.qty),
      originalPrice: Number(r.original_price),
      action: r.action,
      agreedPrice: r.agreed_price === null ? null : Number(r.agreed_price),
    });
    instrBy.set(Number(r.line_id), list);
  }

  const [fresh] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.supplier_name = ${supplier}
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      AND NOT EXISTS (SELECT 1 FROM settlement_line l WHERE l.run_id = ${run.id} AND l.quote_id = q.id)
  `);

  return {
    run: {
      id: Number(run.id),
      status: run.status,
      invoicedAmount: run.invoiced_amount === null ? null : Number(run.invoiced_amount),
      invoiceExportedAt: run.invoice_exported_at,
      agreedAmount: run.agreed_amount === null ? null : Number(run.agreed_amount),
      depositedOn: run.deposited_on,
      depositedAmount: run.deposited_amount === null ? null : Number(run.deposited_amount),
      memo: run.memo,
    },
    supplier,
    ym,
    vatMode,
    lines: lines.map((l) => ({
      lineId: Number(l.line_id),
      quoteId: Number(l.quote_id),
      quoteNo: l.quote_no,
      workDate: l.work_date,
      plateNo: l.plate_no,
      model: l.model,
      billed: Number(l.billed_amount),
      decision: l.decision,
      agreed: l.agreed_amount === null ? null : Number(l.agreed_amount),
      replyMemo: l.reply_memo,
      matchedBy: l.matched_by,
      applied: l.applied_at !== null,
      currentStatus: l.q_status,
      currentTotal: Number(l.q_total),
      paid: Number(l.paid),
      items: itemsBy.get(Number(l.quote_id)) ?? [],
      instructions: instrBy.get(Number(l.line_id)) ?? [],
    })),
    monthCount: Number(month.n),
    monthTotal: Number(month.total),
    newSalesCount: Number(fresh.n),
  };
}

/** 정산을 시작할 만한 거래처 — 최근 넉 달 외상 판매가 있는 곳 */
export async function settleCandidates(): Promise<{ name: string; n: number; recentYm: string }[]> {
  const rows = await db.execute<{ name: string; n: number; recent: string }>(sql`
    SELECT q.supplier_name name, count(*)::int n,
           to_char(max(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)), 'YYYY-MM') recent
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.supplier_name IS NOT NULL
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)
          >= (now() AT TIME ZONE 'Asia/Seoul')::date - 120
    GROUP BY 1 ORDER BY 2 DESC LIMIT 40
  `);
  return rows.map((r) => ({ name: r.name, n: Number(r.n), recentYm: r.recent }));
}
