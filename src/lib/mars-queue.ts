"use server";

/**
 * ⭐ MARS 입력 대기열 (사장님 요청 2026-08-02)
 *
 *   "특히나 MARS 입력은 제발 자동화가 되었으면 좋겠어."
 *
 * MARS = incadea.fastfit on Dynamics 365 Business Central.
 * 「매출 주문」 화면에 사람이 쳐 넣어야 하는 것을, **칠 순서 그대로** 보여준다.
 * 각 칸은 눌러서 복사한다. 다 친 것은 「입력 완료」로 지운다.
 *
 * ⭐ 전기(Posting)까지 자동 (사장님 결정 2026-08-04). 합계가 일치할 때만 —
 *    어긋나면 초안으로 남기고 사람이 본다.
 *    MARS 는 본사 자산이고, 잘못 전기하면 되돌리는 것이 우리 손을 떠난다.
 *
 * ⚠️ 여기 나오는 이름은 **MARS 원본 이름**이다.
 *    화면에서 예쁘게 다듬은 이름(display_name)이 아니라, MARS 상품 마스터에
 *    실제로 들어 있는 이름을 그대로 보여줘야 검색해서 찾을 수 있다 (D-14).
 */

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote } from "@/db/schema";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface MarsLine {
  /** quote_item id — 대기열 화면에서 줄을 바로 고칠 때 쓴다 (사장님 요청 2026-08-05) */
  itemId: number;
  /** MARS 품번(CAI) 또는 서비스 번호 — 이걸로 찾는 것이 가장 빠르다 */
  no: string | null;
  /** MARS 상품 마스터에 실제로 들어 있는 이름 */
  marsName: string;
  qty: number;
  /** 단가 (VAT 포함) */
  unitPrice: number;
  amount: number;
  kind: string;
}

export interface MarsEntry {
  quoteId: number;
  quoteNo: string;
  soldAt: string | null;
  /** MARS 「연락처」 번호 — 개인 고객은 C583-… 이다 (D-10) */
  contactNo: string | null;
  customerName: string | null;
  phone: string | null;
  plateNo: string | null;
  vehicleModel: string | null;
  /**
   * ⭐ 차량의 최근 주행거리 (사장님 버그 제보 2026-08-05).
   *    기존 고객은 newCustomer 가 없어서 주행거리가 MARS 에 안 들어가고 있었다.
   *    판매 등록에서 고치면 vehicle.mileage 가 갱신되고(saveSale), 여기로 실린다 —
   *    안 고치면 마지막으로 알던 값이 그대로 들어간다.
   */
  mileage: number | null;
  /**
   * ⭐ 차량 정보 — 고객은 MARS 에 있는데 **차량만 없는** 경우 차량 카드를 만들 재료
   *    (사장님 버그 제보 2026-08-05 — 렌트카처럼 차가 여러 대인 손님, 차를 바꾼 손님).
   */
  makerName: string | null;
  year: number | null;
  fuelType: string | null;
  /** MARS 차량 번호(V583-…) — 있으면 차량 카드를 **다시 만들지 않는다** (중복 방지) */
  marsVehicleNo: string | null;
  /** 어느 바퀴를 갈았는지 (판매 등록의 체크박스, 사장님 요청 2026-08-05) — 비면 본수로 짐작 */
  tyrePositions: string[];

  /**
   * ⭐ MARS 에 고객·차량이 없을 때 새로 만들 재료 (2026-08-02).
   * 사장님 지적 — "신규고객과 차량의 경우에는 필수로 넣어야 등록이 되는 정보들이 있음."
   *
   * 🔴 `consentSigned` 가 아니면 MARS 고객 생성을 하지 않는다.
   *    MARS 고객 등록 화면에는 「고객 서명」 칸이 있다.
   *    서명받지 않은 것을 「수락된 동의」로 넣으면 안 된다.
   */
  newCustomer: {
    name: string;
    phone: string | null;
    address: string | null;
    consentPrivacy: boolean;
    consentMarketing: boolean;
    consentSigned: boolean;
    plateNo: string;
    makerName: string | null;
    model: string | null;
    year: number | null;
    fuelType: string | null;
    mileage: number | null;
  } | null;
  paymentMethod: string | null;
  /** 실제로 정비한 날 — MARS 문서 날짜·완료 일자 (YYYY-MM-DD) */
  workDate: string | null;
  total: number;
  memo: string | null;
  /** 판매 등록에서 적으신 메모 — MARS 품목 줄의 「설명 2」에 들어간다 */
  saleMemo: string | null;
  lines: MarsLine[];
}

/** 아직 MARS 에 안 친 판매 */
export async function marsQueue(): Promise<MarsEntry[]> {
  const heads = await db.execute<{
    id: number;
    quote_no: string;
    confirmed_at: Date | null;
    contact_no: string | null;
    customer_name: string | null;
    phone: string | null;
    plate_no: string | null;
    vehicle_model: string | null;
    payment_method: string | null;
    work_date: string | null;
    total_amount: number;
    mars_memo: string | null;
    payment_memo: string | null;
    address: string | null;
    consent_privacy: boolean | null;
    consent_marketing: boolean | null;
    consent_signed_at: Date | null;
    maker_name: string | null;
    year: number | null;
    fuel_type: string | null;
    mileage: number | null;
    mars_vehicle_no: string | null;
    tyre_positions: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, q.confirmed_at, q.payment_method, q.work_date::text AS work_date,
           q.total_amount, q.mars_memo, q.payment_memo, q.tyre_positions,
           c.mars_contact_no AS contact_no, c.name AS customer_name, c.phone,
           c.address, c.consent_privacy, c.consent_marketing, c.consent_signed_at,
           v.plate_no, v.model AS vehicle_model, v.maker_name, v.year, v.fuel_type, v.mileage,
           v.mars_vehicle_no
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN vehicle  v ON v.id = q.vehicle_id
    WHERE q.mars_status = '미전송' AND q.status = '성사'
    ORDER BY q.confirmed_at DESC NULLS LAST, q.id DESC
    LIMIT 60
  `);
  if (heads.length === 0) return [];

  const ids = heads.map((h) => Number(h.id));
  const rows = await db.execute<{
    quote_id: number;
    item_id: number;
    no: string | null;
    mars_name: string;
    qty: number;
    final_price: number;
    line_type: string;
  }>(sql`
    SELECT qi.quote_id, qi.id AS item_id,
           COALESCE(p.mars_item_no, s.mars_service_no) AS no,
           -- ⚠️ MARS 원본 이름이 우선이다. 다듬은 이름으로는 MARS 에서 못 찾는다
           COALESCE(p.raw_name, s.name, qi.description) AS mars_name,
           qi.qty, qi.final_price, qi.line_type
    FROM quote_item qi
    LEFT JOIN product      p ON p.id = qi.product_id
    LEFT JOIN service_item s ON s.id = qi.service_item_id
    WHERE qi.quote_id IN ${sql.raw(`(${ids.join(",")})`)}
    ORDER BY qi.quote_id, qi.line_type DESC, qi.id
  `);

  const byQuote = new Map<number, MarsLine[]>();
  for (const r of rows) {
    const k = Number(r.quote_id);
    if (!byQuote.has(k)) byQuote.set(k, []);
    byQuote.get(k)!.push({
      itemId: Number(r.item_id),
      no: r.no,
      marsName: r.mars_name,
      qty: r.qty,
      unitPrice: r.final_price,
      amount: r.final_price * r.qty,
      kind: r.line_type,
    });
  }

  return heads.map((h) => ({
    quoteId: Number(h.id),
    quoteNo: h.quote_no,
    soldAt: h.confirmed_at ? new Date(h.confirmed_at).toLocaleString("ko-KR") : null,
    contactNo: h.contact_no,
    customerName: h.customer_name,
    phone: h.phone,
    plateNo: h.plate_no,
    vehicleModel: h.vehicle_model,
    mileage: h.mileage,
    makerName: h.maker_name,
    year: h.year,
    fuelType: h.fuel_type,
    marsVehicleNo: h.mars_vehicle_no,
    tyrePositions: h.tyre_positions ? h.tyre_positions.split(",").map((s) => s.trim()).filter(Boolean) : [],
    paymentMethod: h.payment_method,
    workDate: h.work_date,
    total: h.total_amount,
    memo: h.mars_memo,
    saleMemo: h.payment_memo,
    lines: byQuote.get(Number(h.id)) ?? [],
    // MARS 연락처 번호가 없으면 = 아직 MARS 에 없는 손님이다
    newCustomer:
      !h.contact_no && h.customer_name && h.plate_no
        ? {
            name: h.customer_name,
            phone: h.phone,
            address: h.address,
            consentPrivacy: h.consent_privacy ?? false,
            consentMarketing: h.consent_marketing ?? false,
            consentSigned: !!h.consent_signed_at,
            plateNo: h.plate_no,
            makerName: h.maker_name,
            model: h.vehicle_model,
            year: h.year,
            fuelType: h.fuel_type,
            mileage: h.mileage,
          }
        : null,
  }));
}

/**
 * MARS 에 다 쳤다 — 대기열에서 내린다.
 *
 * 🔴 **번호 칸과 메모 칸을 섞지 않는다** (2026-08-04).
 *    자동 입력이 「자동입력 2026-08-02 (금액 확인 필요)」 라는 메모를 `mars_ref_no`
 *    (송장번호 칸)에 넣고 있었다. 그래서 번호로 송장을 찾을 수 없었고, 정작 메모 칸은
 *    비어 있어 **왜 금액이 안 맞았는지도 남지 않았다.**
 *
 * @param refNo MARS 매출주문 번호 (`61168583-23SO+000123`). 없으면 비운다
 * @param memo  무슨 일이 있었는지 — 합계 대조 결과 같은 것
 */
export async function markEntered(
  quoteId: number,
  refNo?: string | null,
  memo?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db.select({ id: quote.id }).from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };

  await db
    .update(quote)
    .set({
      marsStatus: "전송완료",
      marsSyncedAt: new Date(),
      marsRefNo: refNo?.trim() || null,
      marsMemo: memo?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  refresh("/mars");
  return { ok: true };
}

/**
 * ⭐ 자동으로 만든 MARS 차량 번호를 기억한다 (2026-08-05).
 *    번호판 검색 색인이 늦어서 「만들었는데 검색에 안 잡히는」 시간이 있다 —
 *    그 사이에 다시 돌리면 같은 차량이 **또** 만들어진다 (실제로 한 번 그랬다,
 *    V583-002652/002653). 번호가 남아 있으면 다시 만들지 않는다.
 */
export async function saveVehicleMarsNo(quoteId: number, marsNo: string): Promise<void> {
  await db.execute(sql`
    UPDATE vehicle SET mars_vehicle_no = ${marsNo}
    WHERE id = (SELECT vehicle_id FROM quote WHERE id = ${quoteId})
      AND mars_vehicle_no IS NULL
  `);
}

/**
 * ⭐ 대기열에서 뺀다 — MARS 에 자동으로 보내지 않고 직접 처리하는 것으로 표시
 *    (사장님 요청 2026-08-05: "대기중인 내역들도 취소나 삭제가 가능했으면 좋겠음").
 *
 * 판매 자체를 지우는 것이 아니다 — 판매 취소는 /sales 의 「판매 취소」가 한다
 * (재고 복원까지). 여기서는 「MARS 자동 입력 대상에서 제외」만 한다.
 * 잘못 뺐으면 최근 목록의 「되돌리기」로 다시 대기열에 올릴 수 있다.
 */
export async function removeFromQueue(
  quoteId: number,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db.select({ id: quote.id }).from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  await db
    .update(quote)
    .set({
      marsStatus: "수동처리",
      marsSyncedAt: new Date(),
      marsRefNo: null,
      marsMemo: note?.trim() || "대기열에서 뺌 — MARS 직접 처리",
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));
  refresh("/mars");
  return { ok: true };
}

/** 잘못 눌렀다 — 다시 대기열로 */
export async function unmarkEntered(quoteId: number): Promise<{ ok: true }> {
  await db
    .update(quote)
    .set({
      marsStatus: "미전송",
      marsSyncedAt: null,
      marsRefNo: null,
      marsMemo: null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));
  refresh("/mars");
  return { ok: true };
}

/**
 * ⭐ 차량 점검이 아직 안 된 판매 (2026-08-02)
 *
 * 전기가 끝나야 들어갈 수 있는 화면이라 매출 주문 입력과 **별개 단계**다.
 * MARS 에 넘긴(전송완료) 것 중 점검을 아직 안 한 것을 찾는다.
 */
export interface PendingCheck {
  quoteId: number;
  quoteNo: string;
  plateNo: string | null;
  customerName: string | null;
  tyreQty: number;
  /**
   * ⭐ 송장을 **번호판만으로** 찾으면 안 된다 (2026-08-04).
   *    단골이면 그 번호판의 송장이 여러 개다. 아래 값들로 한 줄까지 좁힌다.
   */
  total: number;
  /** 실제로 정비한 날 'YYYY-MM-DD' */
  workDate: string | null;
  /** MARS 매출 주문 번호 — 있으면 가장 확실하다 */
  marsRefNo: string | null;
  /**
   * ⭐ 이 판매의 서비스 이름들 (사장님 지시 2026-08-05) —
   *    점검표에서 실제로 교환한 항목(엔진오일·패드·배터리·얼라이먼트)은
   *    100% 가 아니라 **교체 칸**에 표시해야 해서 필요하다.
   */
  serviceNames: string[];
  /** 어느 바퀴를 갈았는지 — 판매 등록의 체크박스 (비면 본수로 짐작) */
  tyrePositions: string[];
}

export async function pendingVehicleChecks(): Promise<PendingCheck[]> {
  const rows = await db.execute<{
    id: number;
    quote_no: string;
    plate_no: string | null;
    name: string | null;
    tyre_qty: number;
    total_amount: number;
    work_date: string | null;
    mars_ref_no: string | null;
    service_names: string[] | null;
    tyre_positions: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, v.plate_no, c.name, q.total_amount, q.mars_ref_no, q.tyre_positions,
           to_char(COALESCE(q.work_date, q.confirmed_at::date, q.created_at::date), 'YYYY-MM-DD') work_date,
           COALESCE(SUM(qi.qty) FILTER (WHERE qi.line_type = 'tire'), 0)::int AS tyre_qty,
           array_agg(qi.description) FILTER (WHERE qi.line_type <> 'tire') AS service_names
    FROM quote q
    LEFT JOIN vehicle    v ON v.id = q.vehicle_id
    LEFT JOIN customer   c ON c.id = q.customer_id
    LEFT JOIN quote_item qi ON qi.quote_id = q.id
    WHERE q.status = '성사'
      AND q.mars_status = '전송완료'
      AND q.vehicle_check_at IS NULL
      AND v.plate_no IS NOT NULL
    GROUP BY q.id, q.quote_no, v.plate_no, c.name, q.total_amount, q.mars_ref_no
    HAVING COALESCE(SUM(qi.qty) FILTER (WHERE qi.line_type = 'tire'), 0) > 0
    ORDER BY q.confirmed_at DESC NULLS LAST
    LIMIT 40
  `);
  return rows.map((r) => ({
    quoteId: Number(r.id),
    quoteNo: r.quote_no,
    plateNo: r.plate_no,
    customerName: r.name,
    tyreQty: Number(r.tyre_qty),
    total: Number(r.total_amount),
    workDate: r.work_date,
    marsRefNo: r.mars_ref_no,
    serviceNames: r.service_names ?? [],
    tyrePositions: r.tyre_positions ? r.tyre_positions.split(",").map((s) => s.trim()).filter(Boolean) : [],
  }));
}

/** 차량 점검을 제출했다 */
export async function markVehicleChecked(quoteId: number): Promise<void> {
  await db
    .update(quote)
    .set({ vehicleCheckAt: new Date(), updatedAt: new Date() })
    .where(eq(quote.id, quoteId));
  refresh("/mars");
}

/** 오늘 친 것 — 되돌릴 때 쓴다. 「수동처리」로 뺀 것도 같이 보여 되돌릴 수 있게 한다 */
export async function marsDone(): Promise<
  { quoteId: number; quoteNo: string; customerName: string | null; total: number; refNo: string | null; status: string }[]
> {
  const rows = await db
    .select({
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      total: quote.totalAmount,
      refNo: quote.marsRefNo,
      status: quote.marsStatus,
      customerName: sql<string | null>`(SELECT name FROM customer c WHERE c.id = ${quote.customerId})`,
    })
    .from(quote)
    .where(sql`${quote.marsStatus} IN ('전송완료', '수동처리') AND ${quote.marsSyncedAt} > now() - interval '2 days'`)
    .orderBy(desc(quote.marsSyncedAt))
    .limit(20);
  return rows;
}
