/**
 * 정비 내역 — 날짜별로 쭉 (사장님 요청 2026-08-04)
 *
 *   "판매 등록 후 mars와 별개로 정비내역이 시스템에 저장되고 관리되고
 *    수정되고 삭제도 가능해야함. 날짜마다 어떤 정비내역이 있는지 확인 가능해야함."
 *
 * 판매(quote)는 저장되고 있었지만 **되짚어 볼 화면이 없었다.**
 * MARS 대기열은 「아직 안 친 것」만 보여주니, 지나간 정비를 찾으려면 DB를 뒤져야 했다.
 *
 * ⚠️ 판매가는 정비사도 본다 — 손님에게 말한 금액이다.
 *    감추는 것은 매입가·마진뿐이다 (D-05). 이 화면에는 애초에 그 둘이 없다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다 (purchase-history 와 같은 이유).
 *    수정·취소 같은 쓰기는 `sale-edit.ts` 가 따로 한다.
 */
import { sql } from "drizzle-orm";

export interface SaleLine {
  itemId: number;
  lineType: string; // 'tire' | 'service' | 'custom'
  description: string;
  qty: number;
  finalPrice: number;
  /** ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」에 들어간 내용 */
  memo: string | null;
}

export interface SaleRow {
  quoteId: number;
  quoteNo: string;
  status: string; // '성사' | '취소'
  /** 실제 정비한 날 */
  workDate: string;
  customerId: number | null;
  customerName: string | null;
  plateNo: string | null;
  vehicleModel: string | null;
  /** 비회원이면 marsMemo 의 「비회원 이름 전화」가 이름 역할을 한다 */
  walkIn: string | null;
  totalAmount: number;
  paymentMethod: string | null;
  paymentMemo: string | null;
  marsStatus: string;
  marsRefNo: string | null;
  /** 갈아 끼운 바퀴 (판매 등록의 체크박스) */
  tyrePositions: string[];
  /** 등록한 시각 'HH:MM' — 작업일과 별개다 */
  createdAt: string | null;
  lines: SaleLine[];
}

export interface SaleDay {
  date: string;
  qty: number;
  amount: number;
  sales: SaleRow[];
}

export interface SaleHistory {
  days: SaleDay[];
  totalAmount: number;
  saleCount: number;
  /** 고를 수 있는 달 ('2026-08'), 최근 순 */
  months: string[];
  /** 필터가 걸려 있으면 그 대상의 이름 (화면 제목용) */
  filterLabel: string | null;
}

/**
 * @param month    '2026-08'. 비우면 전체 기간
 * @param customerId / vehicleId  고객·차량으로 좁히기 — 카드의 「정비 이력」이 쓴다
 * @param includeCanceled  취소된 것도 볼 것인가 (기본 false)
 */
export async function saleHistory(opts: {
  month?: string;
  /** 날짜 구간 (YYYY-MM-DD) — 오늘 보기·기간 직접 지정이 쓴다 (사장님 요청 2026-08-05) */
  from?: string;
  to?: string;
  customerId?: number;
  vehicleId?: number;
  includeCanceled?: boolean;
}): Promise<SaleHistory> {
  const { db } = await import("@/db");
  const m = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : null;
  const okDay = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const from = okDay(opts.from);
  const to = okDay(opts.to);

  const monthRows = await db.execute<{ m: string }>(sql`
    SELECT DISTINCT to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM') m
    FROM quote q ORDER BY 1 DESC
  `);

  const rows = await db.execute<{
    quote_id: number;
    quote_no: string;
    status: string;
    work_date: string;
    customer_id: number | null;
    customer_name: string | null;
    plate_no: string | null;
    vehicle_model: string | null;
    mars_memo: string | null;
    total_amount: number;
    payment_method: string | null;
    payment_memo: string | null;
    mars_status: string;
    mars_ref_no: string | null;
    item_id: number | null;
    line_type: string | null;
    description: string | null;
    qty: number | null;
    final_price: number | null;
    line_memo: string | null;
    tyre_positions: string | null;
    created_hm: string | null;
  }>(sql`
    SELECT q.id quote_id, q.quote_no, q.status,
           to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM-DD') work_date,
           q.customer_id, c.name customer_name, v.plate_no, v.model vehicle_model,
           q.mars_memo, q.total_amount, q.payment_method, q.payment_memo,
           q.mars_status, q.mars_ref_no, q.tyre_positions,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') created_hm,
           qi.id item_id, qi.line_type, qi.description, qi.qty, qi.final_price, qi.memo line_memo
    FROM quote q
    LEFT JOIN customer   c  ON c.id = q.customer_id
    LEFT JOIN vehicle    v  ON v.id = q.vehicle_id
    LEFT JOIN quote_item qi ON qi.quote_id = q.id
    WHERE 1=1
      ${opts.includeCanceled ? sql`` : sql`AND q.status <> '취소'`}
      ${m ? sql`AND to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM') = ${m}` : sql``}
      ${from ? sql`AND COALESCE(q.work_date, q.created_at::date) >= ${from}::date` : sql``}
      ${to ? sql`AND COALESCE(q.work_date, q.created_at::date) <= ${to}::date` : sql``}
      ${opts.customerId ? sql`AND q.customer_id = ${opts.customerId}` : sql``}
      ${opts.vehicleId ? sql`AND q.vehicle_id = ${opts.vehicleId}` : sql``}
    ORDER BY COALESCE(q.work_date, q.created_at::date) DESC, q.id DESC, qi.id
  `);

  const map = new Map<number, SaleRow>();
  for (const r of rows) {
    const id = Number(r.quote_id);
    let s = map.get(id);
    if (!s) {
      s = {
        quoteId: id,
        quoteNo: r.quote_no,
        status: r.status,
        workDate: r.work_date,
        customerId: r.customer_id === null ? null : Number(r.customer_id),
        customerName: r.customer_name,
        plateNo: r.plate_no,
        vehicleModel: r.vehicle_model,
        // 「비회원 …」·「거래처 …」 판매는 marsMemo 가 이름 역할을 한다 (2026-08-05 거래처 판매 추가)
        walkIn: r.mars_memo?.startsWith("비회원") || r.mars_memo?.startsWith("거래처") ? r.mars_memo : null,
        totalAmount: Number(r.total_amount),
        paymentMethod: r.payment_method,
        paymentMemo: r.payment_memo,
        marsStatus: r.mars_status,
        marsRefNo: r.mars_ref_no,
        tyrePositions: r.tyre_positions ? r.tyre_positions.split(",").map((x) => x.trim()).filter(Boolean) : [],
        createdAt: r.created_hm,
        lines: [],
      };
      map.set(id, s);
    }
    if (r.item_id !== null) {
      s.lines.push({
        itemId: Number(r.item_id),
        lineType: r.line_type ?? "custom",
        description: r.description ?? "",
        qty: Number(r.qty ?? 0),
        finalPrice: Number(r.final_price ?? 0),
        memo: r.line_memo,
      });
    }
  }

  const dayMap = new Map<string, SaleDay>();
  for (const s of map.values()) {
    const d =
      dayMap.get(s.workDate) ??
      dayMap.set(s.workDate, { date: s.workDate, qty: 0, amount: 0, sales: [] }).get(s.workDate)!;
    d.sales.push(s);
    if (s.status !== "취소") {
      d.qty += s.lines.filter((l) => l.lineType === "tire").reduce((n, l) => n + l.qty, 0);
      d.amount += s.totalAmount;
    }
  }

  // 필터 대상의 이름 — 화면 제목에 「이 손님의 정비 이력」이라고 보여 준다
  let filterLabel: string | null = null;
  if (opts.vehicleId) {
    const [v] = await db.execute<{ plate_no: string; name: string | null }>(sql`
      SELECT v.plate_no, c.name FROM vehicle v LEFT JOIN customer c ON c.id = v.customer_id
      WHERE v.id = ${opts.vehicleId}`);
    if (v) filterLabel = `${v.plate_no}${v.name ? ` · ${v.name}` : ""}`;
  } else if (opts.customerId) {
    const [c] = await db.execute<{ name: string }>(sql`
      SELECT name FROM customer WHERE id = ${opts.customerId}`);
    if (c) filterLabel = c.name;
  }

  const all = [...map.values()].filter((s) => s.status !== "취소");
  return {
    days: [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date)),
    totalAmount: all.reduce((s, x) => s + x.totalAmount, 0),
    saleCount: all.length,
    months: monthRows.map((r) => r.m),
    filterLabel,
  };
}
