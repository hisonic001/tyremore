/**
 * 매입 내역 — 날짜별로 쭉 (사장님 요청 2026-08-03)
 *
 *   "매입내역을 날짜별로 쭉 확인해볼수 있는 기능도 어딘가 넣어줬으면 좋겠는데"
 *
 * 「입고 예정」은 **아직 안 온 물건**만 보여준다. 이미 들어온 것까지 포함해
 * 언제 어디서 무엇을 얼마에 샀는지 되짚는 화면이 따로 필요하다.
 *
 * ⚠️ 매입가는 사장님만 본다 (D-05 5번). 정비사에게는 수량만 보여준다.
 *    금액을 **서버에서 아예 빼고** 내려보낸다 — 화면에서 감추면 데이터는 이미 나가 있다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다. 서버 컴포넌트(화면)에서 직접 부른다.
 *    서버 액션으로 열어 두면 `canSeeMoney: true` 를 넣어 부르는 길이 생긴다.
 *    권한은 화면이 `isOwner()` 로 판단해 넘긴다.
 */
import { sql } from "drizzle-orm";

export interface PurchaseLine {
  itemId: number;
  cai: string;
  productId: number | null;
  description: string;
  model: string | null;
  spec: string | null;
  qty: number;
  receivedQty: number;
  /** 본당 매입가 (VAT 미포함). 사장님만 */
  unitCost: number | null;
  /** 이 줄의 공급가액. 사장님만 */
  amount: number | null;
}

export interface PurchaseInvoiceRow {
  invoiceId: number;
  invoiceNo: string;
  supplier: string;
  issuedAt: string | null;
  status: string;
  /** 직접 매입인가 (인보이스 파일 없이 손으로 만든 장부) */
  isManual: boolean;
  qty: number;
  receivedQty: number;
  /** 공급가액 합. 사장님만 */
  amount: number | null;
  lines: PurchaseLine[];
}

export interface PurchaseDay {
  /** '2026-08-03' — 발행일이 없으면 '날짜 없음' */
  date: string;
  qty: number;
  amount: number | null;
  invoices: PurchaseInvoiceRow[];
}

export interface PurchaseHistory {
  days: PurchaseDay[];
  /** 고른 기간의 합 */
  totalQty: number;
  totalAmount: number | null;
  invoiceCount: number;
  /** 거래처별 요약 — 어디서 많이 사는지 */
  bySupplier: { supplier: string; qty: number; amount: number | null; invoices: number }[];
  /** 고를 수 있는 달 목록 ('2026-08'), 최근 순 */
  months: string[];
  canSeeMoney: boolean;
}

/**
 * @param money 매입가를 보여도 되는가 — 화면이 `isOwner()` 로 판단해 넘긴다
 * @param month '2026-08' 형식. 비우면 **전체 기간**.
 * @param supplier 거래처 이름으로 좁히기 (선택)
 */
export async function purchaseHistory(
  money: boolean,
  month?: string,
  supplier?: string,
): Promise<PurchaseHistory> {
  const { db } = await import("@/db");
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const sup = supplier?.trim() || null;

  /**
   * 고를 수 있는 달 — 발행일이 없는 장부는 만든 날로 본다.
   * 품목이 하나도 없는 빈 장부는 세지 않는다 (아래 목록에서도 뺀다).
   */
  const monthRows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(COALESCE(i.issued_at::date, i.created_at::date), 'YYYY-MM') m
    FROM purchase_invoice i
    WHERE i.status <> '취소'
      AND EXISTS (SELECT 1 FROM purchase_invoice_item x WHERE x.invoice_id = i.id)
    ORDER BY 1 DESC
  `);

  const rows = await db.execute<{
    invoice_id: number;
    invoice_no: string;
    supplier: string;
    issued_at: string | null;
    status: string;
    item_id: number | null;
    cai: string | null;
    product_id: number | null;
    description: string | null;
    display_name: string | null;
    raw_name: string | null;
    pattern: string | null;
    brand_code: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    qty: number | null;
    received_qty: number | null;
    unit_cost: number | null;
    supply_amount: number | null;
  }>(sql`
    SELECT i.id invoice_id, i.invoice_no, i.supplier,
           COALESCE(i.issued_at, to_char(i.created_at, 'YYYY-MM-DD')) issued_at, i.status,
           x.id item_id, x.cai, x.product_id, x.description,
           p.display_name, p.raw_name, p.pattern, p.brand_code, p.width, p.aspect_ratio, p.rim_inch,
           x.qty, x.received_qty, x.unit_cost, x.supply_amount
    FROM purchase_invoice i
    LEFT JOIN purchase_invoice_item x ON x.invoice_id = i.id
    LEFT JOIN product p ON p.id = x.product_id
    WHERE i.status <> '취소'
      ${m ? sql`AND to_char(COALESCE(i.issued_at::date, i.created_at::date), 'YYYY-MM') = ${m}` : sql``}
      ${sup ? sql`AND replace(lower(i.supplier),' ','') = ${sup.replace(/\s/g, "").toLowerCase()}` : sql``}
    ORDER BY COALESCE(i.issued_at, to_char(i.created_at, 'YYYY-MM-DD')) DESC, i.id DESC, x.id
  `);

  const { parseTireName } = await import("./tire-name");
  const invMap = new Map<number, PurchaseInvoiceRow>();

  for (const r of rows) {
    const id = Number(r.invoice_id);
    let inv = invMap.get(id);
    if (!inv) {
      inv = {
        invoiceId: id,
        invoiceNo: r.invoice_no,
        supplier: r.supplier,
        issuedAt: r.issued_at,
        status: r.status,
        isManual: r.invoice_no.startsWith("직접-"),
        qty: 0,
        receivedQty: 0,
        amount: money ? 0 : null,
        lines: [],
      };
      invMap.set(id, inv);
    }
    // LEFT JOIN 이라 품목이 없는 빈 장부도 한 줄로 들어온다
    if (r.item_id === null) continue;

    const n = r.raw_name
      ? parseTireName(r.raw_name, r.pattern, {
          width: r.width,
          aspectRatio: r.aspect_ratio,
          rimInch: r.rim_inch,
          brandCode: r.brand_code,
        })
      : null;
    const qty = Number(r.qty ?? 0);
    const cost = r.unit_cost === null ? null : Number(r.unit_cost);
    // supply_amount 가 비어 있으면 단가×수량으로 채워 보여준다
    const amount = cost !== null ? (r.supply_amount !== null ? Number(r.supply_amount) : cost * qty) : null;

    inv.lines.push({
      itemId: Number(r.item_id),
      cai: r.cai ?? "",
      productId: r.product_id === null ? null : Number(r.product_id),
      description: r.description ?? "",
      model: r.display_name?.trim() || n?.model || null,
      spec: n?.spec ?? null,
      qty,
      receivedQty: Number(r.received_qty ?? 0),
      unitCost: money ? cost : null,
      amount: money ? amount : null,
    });
    inv.qty += qty;
    inv.receivedQty += Number(r.received_qty ?? 0);
    if (money && inv.amount !== null) inv.amount += amount ?? 0;
  }

  /**
   * ⚠️ 품목이 하나도 없는 장부는 뺀다.
   *    「시작」만 눌러 놓고 아직 아무것도 안 담은 직접 매입 장부가 여기 끼면
   *    「0본 매입」 이라는 이상한 줄이 생긴다 (2026-08-03 시험 중 확인).
   *    그 장부는 매입 입고 화면에 그대로 열려 있으니 사라지는 것이 아니다.
   */
  for (const [id, inv] of invMap) if (inv.lines.length === 0) invMap.delete(id);

  // 날짜별로 묶는다
  const dayMap = new Map<string, PurchaseDay>();
  for (const inv of invMap.values()) {
    const key = inv.issuedAt ?? "날짜 없음";
    const d =
      dayMap.get(key) ?? dayMap.set(key, { date: key, qty: 0, amount: money ? 0 : null, invoices: [] }).get(key)!;
    d.invoices.push(inv);
    d.qty += inv.qty;
    if (money && d.amount !== null) d.amount += inv.amount ?? 0;
  }
  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  const bySupMap = new Map<string, { supplier: string; qty: number; amount: number | null; invoices: number }>();
  for (const inv of invMap.values()) {
    const e =
      bySupMap.get(inv.supplier) ??
      bySupMap
        .set(inv.supplier, { supplier: inv.supplier, qty: 0, amount: money ? 0 : null, invoices: 0 })
        .get(inv.supplier)!;
    e.qty += inv.qty;
    e.invoices++;
    if (money && e.amount !== null) e.amount += inv.amount ?? 0;
  }

  const all = [...invMap.values()];
  return {
    days,
    totalQty: all.reduce((s, i) => s + i.qty, 0),
    totalAmount: money ? all.reduce((s, i) => s + (i.amount ?? 0), 0) : null,
    invoiceCount: all.length,
    bySupplier: [...bySupMap.values()].sort((a, b) => b.qty - a.qty),
    months: monthRows.map((r) => r.m),
    canSeeMoney: money,
  };
}
