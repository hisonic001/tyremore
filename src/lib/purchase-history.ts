/**
 * 매입 내역 — 날짜별로 쭉 (사장님 요청 2026-08-03)
 *
 *   "매입내역을 날짜별로 쭉 확인해볼수 있는 기능도 어딘가 넣어줬으면 좋겠는데"
 *
 * 「입고 예정」은 **아직 안 온 물건**만 보여준다. 이미 들어온 것까지 포함해
 * 언제 어디서 무엇을 얼마에 샀는지 되짚는 화면이 따로 필요하다.
 *
 * ⭐ 2026-08-29 개편 (사장님 요청 — "내역이 너무 많아서 세로로 길어지니 일단 오늘 입고한
 *    내역만 보여주고, 정비내역에서처럼 날짜 필터링이 필요함. 브랜드별·거래처별로도")
 *      · 기간을 **일 단위**로 (오늘·어제·기간 직접). 전엔 월 단위뿐이었다
 *      · **브랜드**로 좁히기 — 🔴 사장님 결정: 그 브랜드 **줄만** 보여주고 합계도 그 줄로만
 *      · 거래처는 그대로 (화면에서 검색창으로 고른다)
 *      · 🔴 **LIMIT 신설.** 전엔 한 군데도 없어 전 기간이면 전부 끌어왔다 —
 *        `/sales` 가 2026-08-07 에 겪은 「폰 브라우저 프리즈」와 같은 길이다
 *
 * ⚠️ 매입가는 사장님만 본다 (D-05 5번). 정비사에게는 수량만 보여준다.
 *    금액을 **서버에서 아예 빼고** 내려보낸다 — 화면에서 감추면 데이터는 이미 나가 있다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다. 서버 컴포넌트(화면)에서 직접 부른다.
 *    서버 액션으로 열어 두면 `canSeeMoney: true` 를 넣어 부르는 길이 생긴다.
 *    권한은 화면이 `isOwner()` 로 판단해 넘긴다.
 */
import { sql } from "drizzle-orm";

/** 브랜드가 없는 줄(상품 미연결)을 고르는 값 — 브랜드로 걸러도 사라지면 안 되는 줄들이다 */
export const NO_BRAND = "(없음)";

/** 한 번에 가져올 장부 수 — 넘으면 화면이 「N건 더 있음」을 알린다 */
const FETCH_CAP = 200;

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
  /** ⭐ 브랜드 (2026-08-29) — 상품이 안 이어진 줄은 null */
  brandCode: string | null;
  brandName: string | null;
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

/** 거래처·브랜드 요약 한 줄 (같은 모양) */
export interface PurchaseGroup {
  key: string;
  label: string;
  qty: number;
  amount: number | null;
  invoices: number;
  unit: "본" | "개";
}

export interface PurchaseHistory {
  days: PurchaseDay[];
  /** 고른 기간의 합 */
  totalQty: number;
  totalUnit: "본" | "개";
  totalAmount: number | null;
  invoiceCount: number;
  /** 🔴 자르기 전 장부 수 — 목록이 잘렸는지 화면이 알아야 한다 */
  totalInvoiceCount: number;
  /** 거래처별 요약 — 어디서 많이 사는지 (🔴 **기간만** 적용한 값) */
  bySupplier: PurchaseGroup[];
  /** ⭐ 브랜드별 요약 (2026-08-29) — 역시 **기간만** 적용한 값 */
  byBrand: PurchaseGroup[];
  /** 고를 수 있는 달 목록 ('2026-08'), 최근 순 */
  months: string[];
  canSeeMoney: boolean;
}

export interface PurchaseFilter {
  /** 'YYYY-MM' */
  month?: string;
  /** 'YYYY-MM-DD' */
  from?: string;
  to?: string;
  supplier?: string;
  /** 브랜드 코드 · `NO_BRAND` 면 상품이 안 이어진 줄 */
  brand?: string;
}

const okMonth = (x?: string) => (x && /^\d{4}-\d{2}$/.test(x) ? x : null);
const okDay = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
const supKey = (s: string) => s.replace(/\s/g, "").toLowerCase();

type Raw = {
  invoice_id: number;
  invoice_no: string;
  supplier: string;
  status: string;
  item_id: number | null;
  cai: string | null;
  product_id: number | null;
  description: string | null;
  display_name: string | null;
  raw_name: string | null;
  pattern: string | null;
  brand_code: string | null;
  brand_name: string | null;
  width: number | null;
  aspect_ratio: number | null;
  rim_inch: string | null;
  qty: number | null;
  received_qty: number | null;
  unit_cost: number | null;
  supply_amount: number | null;
  is_serialized: boolean | null;
};

type GroupRaw = {
  supplier: string;
  brand_code: string;
  brand_name: string;
  qty: string;
  amount: string;
  invoices: number;
  parts: number;
};

/**
 * @param money 매입가를 보여도 되는가 — 화면이 `isOwner()` 로 판단해 넘긴다
 * @param f 기간·거래처·브랜드. 비우면 **전체 기간** (화면이 기본을 「오늘」로 정한다)
 */
export async function purchaseHistory(money: boolean, f: PurchaseFilter = {}): Promise<PurchaseHistory> {
  const { db } = await import("@/db");
  const m = okMonth(f.month);
  const from = okDay(f.from);
  const to = okDay(f.to);
  const sup = f.supplier?.trim() || null;
  const brand = f.brand?.trim() || null;

  /**
   * 🔴 매입 내역의 날짜 기준은 **입고 확정 시각**이다 (사장님 지시 2026-08-08).
   *    "전량입고 혹은 입고확정 버튼을 누르는 때가 입고가 되는 순간이며, 매입내역에도
   *     입고되기 전까지는 목록에 포함하지 않고 입고 되는 순간을 기점으로 기록해줘."
   *    → 입고된 줄이 하나도 없는 장부는 여기 안 나온다 (입고 예정 화면에는 그대로 있다).
   *    사장님이 말씀하신 **「오늘 입고한 내역」이 곧 이 기준**이다 (2026-08-29).
   */
  const monthRows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(x.received_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') m
    FROM purchase_invoice_item x JOIN purchase_invoice i ON i.id = x.invoice_id
    WHERE i.status <> '취소' AND x.received_qty > 0 AND x.received_at IS NOT NULL
    ORDER BY 1 DESC
  `);

  /** 장부의 마지막 입고 확정일 — 입고된 줄이 없으면 NULL 이라 아래에서 걸러진다 */
  const RECV = sql`(SELECT to_char(MAX(r.received_at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
                    FROM purchase_invoice_item r WHERE r.invoice_id = i.id AND r.received_qty > 0)`;
  /** 기간 조건 — sale-history.ts 와 같은 모양 */
  const period = sql`
    ${m ? sql`AND d.recv_date LIKE ${m + "%"}` : sql``}
    ${from ? sql`AND d.recv_date >= ${from}` : sql``}
    ${to ? sql`AND d.recv_date <= ${to}` : sql``}`;
  const supCond = sup ? sql`AND replace(lower(i.supplier), ' ', '') = ${supKey(sup)}` : sql``;
  /**
   * 🔴 브랜드는 **줄 단위**로 건다 (사장님 결정 2026-08-29 — "그 브랜드 줄만").
   *    `(없음)` = 브랜드가 정해지지 않은 줄. 실측 25줄 43개는 **상품은 이어져 있는데
   *    `brand_code` 가 비어 있는** 것들이다(부품 위주). 조건을 `product_id IS NULL` 로
   *    잡았더니 0건이 나왔다 — **후보를 세는 식(`COALESCE(p.brand_code, …)`)과 같은 잣대**를
   *    써야 한다. 브랜드로 거를 때 이 줄들이 조용히 사라지면 안 된다.
   */
  const brandCond = !brand
    ? sql``
    : brand === NO_BRAND
      ? sql`AND p.brand_code IS NULL`
      : sql`AND p.brand_code = ${brand}`;

  /* ── ① 어느 장부를 보여줄지 — 자르기는 여기서 (합계는 아래에서 따로 센다) ── */
  const idRows = await db.execute<{ id: number; recv: string }>(sql`
    SELECT i.id, d.recv_date recv
    FROM purchase_invoice i
    JOIN LATERAL (SELECT ${RECV} AS recv_date) d ON TRUE
    JOIN purchase_invoice_item x ON x.invoice_id = i.id
    LEFT JOIN product p ON p.id = x.product_id
    WHERE i.status <> '취소' AND d.recv_date IS NOT NULL ${period} ${supCond} ${brandCond}
    GROUP BY i.id, d.recv_date
    ORDER BY d.recv_date DESC, i.id DESC
    LIMIT ${FETCH_CAP}
  `);
  /** 자르기 전 장부 수 — 「N건 더 있음」을 정직하게 말하려고 */
  const [cnt] = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT i.id)::int n
    FROM purchase_invoice i
    JOIN LATERAL (SELECT ${RECV} AS recv_date) d ON TRUE
    JOIN purchase_invoice_item x ON x.invoice_id = i.id
    LEFT JOIN product p ON p.id = x.product_id
    WHERE i.status <> '취소' AND d.recv_date IS NOT NULL ${period} ${supCond} ${brandCond}
  `);

  const ids = idRows.map((r) => Number(r.id));
  const recvOf = new Map(idRows.map((r) => [Number(r.id), r.recv]));

  /* ── ② 그 장부들의 줄 (브랜드로 걸렀으면 그 줄만) ── */
  const rows =
    ids.length === 0
      ? []
      : await db.execute<Raw>(sql`
          SELECT i.id invoice_id, i.invoice_no, i.supplier, i.status,
                 x.id item_id, x.cai, x.product_id, x.description,
                 p.display_name, p.raw_name, p.pattern, p.brand_code, b.name_ko brand_name,
                 p.width, p.aspect_ratio, p.rim_inch,
                 x.qty, x.received_qty, x.unit_cost, x.supply_amount, p.is_serialized
          FROM purchase_invoice i
          JOIN purchase_invoice_item x ON x.invoice_id = i.id
          LEFT JOIN product p ON p.id = x.product_id
          LEFT JOIN brand b ON b.code = p.brand_code
          WHERE i.id IN (${sql.join(ids.map((n) => sql`${n}`), sql`, `)}) ${brandCond}
          ORDER BY i.id DESC, x.id
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
        issuedAt: recvOf.get(id) ?? null,
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
      brandCode: r.brand_code,
      brandName: r.brand_name,
    });
    inv.qty += qty;
    inv.receivedQty += Number(r.received_qty ?? 0);
    if (money && inv.amount !== null) inv.amount += amount ?? 0;
  }

  /**
   * ⚠️ 품목이 하나도 없는 장부는 뺀다.
   *    「시작」만 눌러 놓고 아직 아무것도 안 담은 직접 매입 장부가 여기 끼면
   *    「0본 매입」 이라는 이상한 줄이 생긴다 (2026-08-03 시험 중 확인).
   */
  for (const [id, inv] of invMap) if (inv.lines.length === 0) invMap.delete(id);
  /** 줄이 하나라도 부품이면 장부 단위는 '개' — 「4본」이라고 부품을 세지 않는다 */
  for (const inv of invMap.values()) inv.unit = inv.lines.every((l) => l.unit === "본") ? "본" : "개";

  // 날짜별로 묶는다
  const dayMap = new Map<string, PurchaseDay>();
  for (const inv of invMap.values()) {
    const key = inv.issuedAt ?? "날짜 없음";
    const d =
      dayMap.get(key) ??
      dayMap.set(key, { date: key, qty: 0, amount: money ? 0 : null, unit: "본", invoices: [] }).get(key)!;
    d.invoices.push(inv);
    d.qty += inv.qty;
    if (inv.unit === "개") d.unit = "개";
    if (money && d.amount !== null) d.amount += inv.amount ?? 0;
  }
  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  /* ── ③ 거래처·브랜드 후보 — 🔴 **기간만** 적용해서 센다 ──
     자기 필터까지 걸어 뽑으면 한 번 고른 뒤 다른 거래처·브랜드로 옮길 수가 없다. */
  const groupRows = await db.execute<GroupRaw>(sql`
    SELECT i.supplier,
           COALESCE(p.brand_code, ${NO_BRAND}) brand_code,
           COALESCE(b.name_ko, p.brand_code, ${NO_BRAND}) brand_name,
           COALESCE(SUM(x.qty), 0)::text qty,
           COALESCE(SUM(COALESCE(x.supply_amount, x.unit_cost * x.qty)), 0)::text amount,
           count(DISTINCT i.id)::int invoices,
           count(*) FILTER (WHERE p.is_serialized = false)::int parts
    FROM purchase_invoice i
    JOIN LATERAL (SELECT ${RECV} AS recv_date) d ON TRUE
    JOIN purchase_invoice_item x ON x.invoice_id = i.id
    LEFT JOIN product p ON p.id = x.product_id
    LEFT JOIN brand b ON b.code = p.brand_code
    WHERE i.status <> '취소' AND d.recv_date IS NOT NULL ${period}
    GROUP BY 1, 2, 3
  `);

  const roll = (keyOf: (r: GroupRaw) => { key: string; label: string }): PurchaseGroup[] => {
    const map = new Map<string, PurchaseGroup>();
    for (const r of groupRows) {
      const { key, label } = keyOf(r);
      const e: PurchaseGroup = map.get(key) ?? { key, label, qty: 0, amount: money ? 0 : null, invoices: 0, unit: "본" };
      e.qty += Number(r.qty);
      e.invoices += Number(r.invoices);
      if (Number(r.parts) > 0) e.unit = "개";
      if (money && e.amount !== null) e.amount += Number(r.amount);
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty);
  };

  const all = [...invMap.values()];
  return {
    days,
    totalQty: all.reduce((s, i) => s + i.qty, 0),
    totalUnit: all.every((i) => i.unit === "본") ? "본" : "개",
    totalAmount: money ? all.reduce((s, i) => s + (i.amount ?? 0), 0) : null,
    invoiceCount: all.length,
    totalInvoiceCount: Number(cnt?.n ?? all.length),
    bySupplier: roll((r) => ({ key: r.supplier, label: r.supplier })),
    byBrand: roll((r) => ({ key: r.brand_code, label: r.brand_name })),
    months: monthRows.map((r) => r.m),
    canSeeMoney: money,
  };
}
