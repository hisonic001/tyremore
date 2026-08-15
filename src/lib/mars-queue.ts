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

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote } from "@/db/schema";
import { requestMarsRun } from "./mars-run";

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
  /** ⭐ 줄별 메모 (사장님 지시 2026-08-07) — **이 줄의 「설명 2」**에 들어간다 */
  memo: string | null;
  /** ⭐ 기표가 (2026-08-08) — 대기열 「품목 고치기」의 할인 계산 기준 */
  listPrice: number | null;
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
  /**
   * ⭐ MARS 결제 수단 코드에 쓸 수단 (사장님 지시 2026-08-10).
   *    혼합(분할 결제)이면 **금액이 가장 큰 수단** — 동액이면 먼저 고른 것.
   *    지역화폐→현금 변환은 mars-fill 의 PAY_CODE 가 맡는다.
   */
  marsPayMethod: string | null;
  /** 실제로 정비한 날 — MARS 문서 날짜·완료 일자 (YYYY-MM-DD) */
  workDate: string | null;
  total: number;
  memo: string | null;
  lines: MarsLine[];
}

/**
 * ⭐ 정비 내역에서 **체크한 판매만** MARS 로 보낸다 (사장님 지시 2026-08-09).
 *
 *   "판매 등록시에 MARS 입력 대기열 화면으로도 판매내역이 넘어가는데 … 페이지 자체를 삭제.
 *    정비 내역에 MARS 자동 올리기 버튼을 만들고 … 체크한 카드들이 자동으로 올라가고
 *    등록되었다는 표식이 생김."
 *
 * 판매 등록은 이제 '보류' 로 저장된다 — 자동으로 대기열에 올라가지 않는다.
 * 여기서 체크한 것만 '미전송' 이 되고, 매장 PC 의 mars-agent 가 그것만 집어 간다
 * (marsQueue() 가 '미전송' 만 보므로 **매장 PC 스크립트는 안 고쳐도 된다**).
 */
export async function queueForMars(
  quoteIds: number[],
): Promise<{ ok: true; queued: number; runExisting: boolean } | { ok: false; error: string }> {
  const { getSession } = await import("./auth");
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  const ids = quoteIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { ok: false, error: "올릴 판매를 선택해 주세요" };

  // '해당없음'(거래처·서비스)과 이미 올라간 '전송완료'는 서버에서도 막는다
  const updated = await db
    .update(quote)
    .set({ marsStatus: "미전송", updatedAt: new Date() })
    .where(
      and(
        inArray(quote.id, ids),
        eq(quote.status, "성사"),
        inArray(quote.marsStatus, ["보류", "수동처리"]),
      ),
    )
    .returning({ id: quote.id });

  if (updated.length === 0) {
    return { ok: false, error: "올릴 수 있는 판매가 없습니다 — 이미 올라갔거나 MARS 대상이 아닙니다" };
  }

  // 실행 요청까지 한 번에 — 이미 대기·실행중이면 그 실행 뒤에 남는다 (다시 요청하면 된다)
  const run = await requestMarsRun("입력");
  refresh("/sales");
  return { ok: true, queued: updated.length, runExisting: run.ok ? run.existing : false };
}

/** 아직 MARS 에 안 친 판매 — 정비 내역에서 체크해 '미전송' 이 된 것들 */
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
    split_main: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, q.confirmed_at, q.payment_method, q.work_date::text AS work_date,
           q.total_amount, q.mars_memo, q.tyre_positions,
           -- 분할 결제의 대표 수단: 금액 큰 것, 동액이면 먼저 고른 것 (사장님 지시 2026-08-10)
           (SELECT pm.method FROM quote_payment pm WHERE pm.quote_id = q.id
             ORDER BY pm.amount DESC, pm.id ASC LIMIT 1) AS split_main,
           c.mars_contact_no AS contact_no, c.name AS customer_name, c.phone,
           c.address, c.consent_privacy, c.consent_marketing, c.consent_signed_at,
           v.plate_no, v.model AS vehicle_model, v.maker_name, v.year, v.fuel_type,
           -- 판매 등록 때 입력한 주행거리가 우선 — 그 판매의 값이다 (2026-08-08)
           COALESCE(q.mileage, v.mileage) AS mileage,
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
    memo: string | null;
    list_price: number | null;
  }>(sql`
    SELECT qi.quote_id, qi.id AS item_id,
           COALESCE(p.mars_item_no, s.mars_service_no) AS no,
           -- ⚠️ MARS 원본 이름이 우선이다. 다듬은 이름으로는 MARS 에서 못 찾는다
           COALESCE(p.raw_name, s.name, qi.description) AS mars_name,
           qi.qty, qi.final_price, qi.line_type, qi.memo, p.list_price
    FROM quote_item qi
    LEFT JOIN product      p ON p.id = qi.product_id
    LEFT JOIN service_item s ON s.id = qi.service_item_id
    WHERE qi.quote_id IN ${sql.raw(`(${ids.join(",")})`)}
      -- 🔴 부품 소모(use) 줄은 MARS 에 안 넣는다 (2026-08-11) — 0원·품번 없음이라
      --    넣으면 mars-fill 이 「줄 부족」으로 실패한다
      AND qi.line_type <> 'use'
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
      memo: r.memo,
      listPrice: r.list_price === null ? null : Number(r.list_price),
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
    marsPayMethod: h.payment_method === "혼합" ? (h.split_main ?? null) : h.payment_method,
    workDate: h.work_date,
    total: h.total_amount,
    memo: h.mars_memo,
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

  refresh("/sales");
  return { ok: true };
}

/**
 * ⭐ 대기열에서 내려 「보류」로 되돌린다 (2026-08-15).
 *
 * 🔴 이원섭 건(Q26-0810-012)이 동의 서명이 없어 **18번 연속** 같은 경고를 내며
 *    재시도됐다 — 자동입력이 못 푸는 문제(서명·사람 확인)는 대기열에 남겨 두면
 *    로그만 어지럽힌다. 보류로 내리면, 서명을 받은 뒤 정비 내역에서 다시
 *    체크하는 순간 (보류→미전송) 도로 올라간다 — 기존 흐름 그대로다.
 */
export async function holdMars(quoteId: number, memo?: string | null): Promise<void> {
  await db
    .update(quote)
    .set({ marsStatus: "보류", marsMemo: memo?.trim() || null, updatedAt: new Date() })
    .where(and(eq(quote.id, quoteId), eq(quote.marsStatus, "미전송")));
  refresh("/sales");
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
           -- 부품 소모(use) 줄은 「교환한 항목」 판정에서 뺀다 — 서비스 줄이 그 역할을 한다 (2026-08-11)
           array_agg(qi.description) FILTER (WHERE qi.line_type NOT IN ('tire', 'use')) AS service_names
    FROM quote q
    LEFT JOIN vehicle    v ON v.id = q.vehicle_id
    LEFT JOIN customer   c ON c.id = q.customer_id
    LEFT JOIN quote_item qi ON qi.quote_id = q.id
    WHERE q.status = '성사'
      AND q.mars_status = '전송완료'
      AND q.vehicle_check_at IS NULL
      AND v.plate_no IS NOT NULL
      -- 🔴 앱으로 등록한 판매만 (Q26-…). MARS 이관분(MARS-…) 3천여 건이
      --    밀려들면 점검 실행이 과거를 훑느라 끝나지 않는다 (2026-08-10)
      AND q.quote_no LIKE 'Q%'
    GROUP BY q.id, q.quote_no, v.plate_no, c.name, q.total_amount, q.mars_ref_no
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
  refresh("/sales");
}
