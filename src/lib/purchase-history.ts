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
  /** ⭐ 세는 단위 (사장님 지시 2026-08-18) — 타이어 '본', 부품 '개' */
  unit: "본" | "개";
}

export interface PurchaseInvoiceRow {
  invoiceId: number;
  invoiceNo: string;
  supplier: string;
  /** 🔴 마지막 **입고 확정일**(KST) — 발행일이 아니다 (사장님 지시 2026-08-08) */
  issuedAt: string | null;
  status: string;
  /** 직접 매입인가 (인보이스 파일 없이 손으로 만든 장부) */
  isManual: boolean;
  qty: number;
  receivedQty: number;
  /** 공급가액 합. 사장님만 */
  amount: number | null;
  /** 줄들이 전부 타이어면 '본', 아니면 '개' */
  unit: "본" | "개";
  lines: PurchaseLine[];
}

export interface PurchaseDay {
  /** '2026-08-03' — **입고 확정일** 기준 (사장님 지시 2026-08-08) */
  date: string;
  qty: number;
  amount: number | null;
  unit: "본" | "개";
  invoices: PurchaseInvoiceRow[];
}

export interface PurchaseHistory {
  days: PurchaseDay[];
  /** 고른 기간의 합 */
  totalQty: number;
  totalUnit: "본" | "개";
  totalAmount: number | null;
  invoiceCount: number;
  /** 거래처별 요약 — 어디서 많이 사는지 */
  bySupplier: { supplier: string; qty: number; amount: number | null; invoices: number; unit: "본" | "개" }[];
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
   * 🔴 매입 내역의 날짜 기준은 **입고 확정 시각**이다 (사장님 지시 2026-08-08).
   *    "전량입고 혹은 입고확정 버튼을 누르는 때가 입고가 되는 순간이며, 매입내역에도
   *     입고되기 전까지는 목록에 포함하지 않고 입고 되는 순간을 기점으로 기록해줘."
   *    → 입고된 줄이 하나도 없는 장부는 여기 안 나온다 (입고 예정 화면에는 그대로 있다).
   *      날짜는 발행일이 아니라 마지막 입고 확정 시각(KST)이다.
   */
  const monthRows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(x.received_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') m
    FROM purchase_invoice_item x JOIN purchase_invoice i ON i.id = x.invoice_id
    WHERE i.status <> '취소' AND x.received_qty > 0 AND x.received_at IS NOT NULL
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
    is_serialized: boolean | null;
  }>(sql`
    SELECT i.id invoice_id, i.invoice_no, i.supplier,
           d.recv_date AS issued_at, i.status,
           x.id item_id, x.cai, x.product_id, x.description,
           p.display_name, p.raw_name, p.pattern, p.brand_code, p.width, p.aspect_ratio, p.rim_inch,
           x.qty, x.received_qty, x.unit_cost, x.supply_amount, p.is_serialized
    FROM purchase_invoice i
    JOIN LATERAL (
      -- 이 장부의 마지막 입고 확정일 — 입고된 줄이 없으면 NULL 이라 아래에서 걸러진다
      SELECT to_char(MAX(r.received_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS recv_date
      FROM purchase_invoice_item r
      WHERE r.invoice_id = i.id AND r.received_qty > 0
    ) d ON TRUE
    LEFT JOIN purchase_invoice_item x ON x.invoice_id = i.id
    LEFT JOIN product p ON p.id = x.product_id
    WHERE i.status <> '취소'
      AND d.recv_date IS NOT NULL
      ${m ? sql`AND left(d.recv_date, 7) = ${m}` : sql``}
      ${sup ? sql`AND replace(lower(i.supplier),' ','') = ${sup.replace(/\s/g, "").toLowerCase()}` : sql``}
    ORDER BY d.recv_date DESC, i.id DESC, x.id
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
        unit: "본",
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
      // 상품 연결이 없는 옛 타이어 인보이스 줄은 '본'으로 (부품임이 확실할 때만 '개')
      unit: r.is_serialized === false ? "개" : "본",
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
  /** 줄이 하나라도 부품이면 장부 단위는 '개' — 「4본」이라고 부품을 세지 않는다 */
  for (const inv of invMap.values()) {
    inv.unit = inv.lines.every((l) => l.unit === "본") ? "본" : "개";
  }

  // 날짜별로 묶는다
  const dayMap = new Map<string, PurchaseDay>();
  for (const inv of invMap.values()) {
    const key = inv.issuedAt ?? "날짜 없음";
    const d =
      dayMap.get(key) ?? dayMap.set(key, { date: key, qty: 0, amount: money ? 0 : null, unit: "본", invoices: [] }).get(key)!;
    d.invoices.push(inv);
    d.qty += inv.qty;
    if (inv.unit === "개") d.unit = "개";
    if (money && d.amount !== null) d.amount += inv.amount ?? 0;
  }
  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  const bySupMap = new Map<string, { supplier: string; qty: number; amount: number | null; invoices: number; unit: "본" | "개" }>();
  for (const inv of invMap.values()) {
    const e =
      bySupMap.get(inv.supplier) ??
      bySupMap
        .set(inv.supplier, { supplier: inv.supplier, qty: 0, amount: money ? 0 : null, invoices: 0, unit: "본" })
        .get(inv.supplier)!;
    e.qty += inv.qty;
    e.invoices++;
    if (inv.unit === "개") e.unit = "개";
    if (money && e.amount !== null) e.amount += inv.amount ?? 0;
  }

  const all = [...invMap.values()];
  return {
    days,
    totalQty: all.reduce((s, i) => s + i.qty, 0),
    totalUnit: all.every((i) => i.unit === "본") ? "본" : "개",
    totalAmount: money ? all.reduce((s, i) => s + (i.amount ?? 0), 0) : null,
    invoiceCount: all.length,
    bySupplier: [...bySupMap.values()].sort((a, b) => b.qty - a.qty),
    months: monthRows.map((r) => r.m),
    canSeeMoney: money,
  };
}
