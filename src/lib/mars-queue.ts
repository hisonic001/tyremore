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
import { marsMissing } from "./mars-ready";
import { requestMarsRun } from "./mars-run";
import { PERM_DENIED } from "./perm-keys";

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
  /** 차량 모델 — MARS 필수 정보 검사(mars-ready)와 차량 카드 만들기에 쓴다 */
  vehicleModel: string | null;
  /**
   * ⭐ 차량의 최근 주행거리 (사장님 버그 제보 2026-08-05).
   *    기존 고객은 newCustomer 가 없어서 주행거리가 MARS 에 안 들어가고 있었다.
   *    판매 등록에서 고치면 vehicle.mileage 가 갱신되고(saveSale), 여기로 실린다 —
   *    안 고치면 마지막으로 알던 값이 그대로 들어간다.
   */
  mileage: number | null;
  /**
   * ⭐ 이 차로 이미 MARS 에 올라간(전송완료) 판매들의 최대 주행거리 (2026-08-17).
   *    MARS 는 등록된 값보다 **적은** 주행거리를 거부한다(사장님 관찰) — MARS 값을
   *    직접 읽을 수는 없으니 이 값을 근사치로 쓴다. mars-fill 이 사전에 거른다.
   */
  postedMaxMileage: number | null;
  /**
   * ⭐ 차량 정보 — 고객은 MARS 에 있는데 **차량만 없는** 경우 차량 카드를 만들 재료
   *    (사장님 버그 제보 2026-08-05 — 렌트카처럼 차가 여러 대인 손님, 차를 바꾼 손님).
   */
  makerName: string | null;
  year: number | null;
  fuelType: string | null;
  /** MARS 차량 번호(V583-…) — 있으면 차량 카드를 **다시 만들지 않는다** (중복 방지) */
  marsVehicleNo: string | null;
  /**
   * ⭐ 지난 시도가 만들다 만/만든 매출 주문(SO) 번호 (2026-08-18 단계2).
   *    있으면 새 주문을 만들지 않고 그 초안을 열어 이어서 한다 — 고아 초안 근절.
   */
  marsOrderNo: string | null;
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
): Promise<
  | { ok: true; queued: number; runExisting: boolean; warning: string | null }
  | { ok: false; error: string }
> {
  if (!(await (await import("./auth")).hasPerm("mars"))) return { ok: false, error: PERM_DENIED };
  const { getSession } = await import("./auth");
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  const ids = quoteIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { ok: false, error: "올릴 판매를 선택해 주세요" };

  /**
   * ⭐ MARS 필수 정보 문지기 (사장님 지시 2026-08-17, 두 차례):
   *   ① 차대번호를 뺀 고객·차량 필수 정보가 하나라도 없으면 올리지 않는다 —
   *      "mars에는 사실 차대번호를 제외한 고객과 차량 정보가 없으면 입력이 안될것임"
   *      규칙은 mars-ready.ts 한 곳 (화면 체크박스·매장 PC 와 같은 규칙).
   *   ② 주행거리가 MARS 에 등록된 값보다 **적어도** 거부된다 (사장님 관찰).
   *      MARS 의 값은 직접 못 읽으니, 같은 차의 전송완료 건 중 최대 주행거리를
   *      근사치로 쓴다 — 덜 막을지언정 더 막지는 않는다.
   *   막힌 건은 그대로 두고 나머지만 올린다 — 한 건 때문에 전부 멈추지 않는다.
   */
  const inList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const cands = await db.execute<{
    id: number;
    quote_no: string;
    payment_method: string | null;
    reservation_status: string | null;
    vehicle_id: number | null;
    mars_vehicle_no: string | null;
    maker_name: string | null;
    model: string | null;
    year: number | null;
    fuel_type: string | null;
    eff: number | null;
    mars_contact_no: string | null;
    customer_name: string | null;
    phone: string | null;
    address: string | null;
    consent_signed: boolean | null;
    posted_max: number | null;
    total_amount: number;
  }>(sql`
    SELECT q.id, q.quote_no, q.payment_method, q.vehicle_id, q.total_amount,
           v.mars_vehicle_no, v.maker_name, v.model, v.year, v.fuel_type,
           COALESCE(q.mileage, v.mileage)::int AS eff,
           q.reservation_status,
           c.mars_contact_no, c.name customer_name, c.phone, c.address,
           (c.consent_signed_at IS NOT NULL) consent_signed,
           (SELECT max(q2.mileage)::int FROM quote q2
             WHERE q2.vehicle_id = q.vehicle_id AND q2.id <> q.id
               AND q2.mars_status = '전송완료' AND q2.mileage IS NOT NULL) AS posted_max
    FROM quote q
    LEFT JOIN vehicle  v ON v.id = q.vehicle_id
    LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.id IN (${inList}) AND q.status = '성사' AND q.mars_status IN ('보류', '수동처리')
  `);
  const blocked: string[] = [];
  const allowed: number[] = [];
  for (const r of cands) {
    // ⭐ 예약중은 아직 시공 전이다 (2026-09-01) — 지금 올리면 시공도 안 한 매출이 전기된다
    if (r.reservation_status === "예약중") {
      blocked.push(`${r.quote_no}: 예약 건입니다 — 시공 완료 후에 올릴 수 있습니다`);
      continue;
    }
    // 외상·서비스는 MARS 대상이 아니다 (2026-08-17 — 올려 봐야 로봇이 되돌린다)
    if (r.payment_method === "외상" || r.payment_method === "서비스") {
      blocked.push(
        r.payment_method === "외상"
          ? `${r.quote_no}: 외상은 MARS 에 넣지 않습니다 — 수금 뒤 결제를 실제 수단으로 바꾸고 다시 체크해 주세요`
          : `${r.quote_no}: 서비스(무상)는 MARS 에 넣지 않습니다`,
      );
      continue;
    }
    // 0원·마이너스(환불) 판매는 MARS 자동 입력 대상이 아니다 (2026-08-21) — 반품은 MARS 에서 직접
    if (Number(r.total_amount) <= 0) {
      blocked.push(`${r.quote_no}: 0원·마이너스(환불) 판매는 MARS 에 넣지 않습니다 — 반품은 MARS 에서 직접 처리해 주세요`);
      continue;
    }
    const eff = r.eff === null ? null : Number(r.eff);
    const postedMax = r.posted_max === null ? null : Number(r.posted_max);
    const missing = marsMissing({
      hasVehicle: r.vehicle_id !== null,
      marsVehicleNo: r.mars_vehicle_no,
      makerName: r.maker_name,
      model: r.model,
      year: r.year === null ? null : Number(r.year),
      fuelType: r.fuel_type,
      mileage: eff,
      contactNo: r.mars_contact_no,
      customerName: r.customer_name,
      phone: r.phone,
      address: r.address,
      consentSigned: r.consent_signed === true,
    });
    if (missing.length) {
      blocked.push(`${r.quote_no}: ${missing.join(" · ")} 이(가) 없습니다`);
    } else if (eff !== null && postedMax !== null && eff < postedMax) {
      blocked.push(
        `${r.quote_no}: MARS 에 ${postedMax.toLocaleString()}km 로 등록된 차인데 이 판매는 ${eff.toLocaleString()}km 입니다 — MARS 는 적은 값을 거부합니다. 주행거리를 고쳐 주세요`,
      );
    } else {
      allowed.push(Number(r.id));
    }
  }
  if (allowed.length === 0) {
    return {
      ok: false,
      error: blocked.length
        ? `올리지 못했습니다.\n${blocked.join("\n")}`
        : "올릴 수 있는 판매가 없습니다 — 이미 올라갔거나 MARS 대상이 아닙니다",
    };
  }

  // '해당없음'(거래처·서비스)과 이미 올라간 '전송완료'는 서버에서도 막는다
  const updated = await db
    .update(quote)
    .set({ marsStatus: "미전송", updatedAt: new Date() })
    .where(
      and(
        inArray(quote.id, allowed),
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
  return {
    ok: true,
    queued: updated.length,
    runExisting: run.ok ? run.existing : false,
    warning: blocked.length ? `⚠️ ${blocked.length}건은 빠졌습니다.\n${blocked.join("\n")}` : null,
  };
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
    posted_max: number | null;
    mars_vehicle_no: string | null;
    mars_order_no: string | null;
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
           -- 이 차로 이미 MARS 에 올라간 건들의 최대 주행거리 (2026-08-17 — 적으면 MARS 가 거부)
           (SELECT max(q2.mileage)::int FROM quote q2
             WHERE q2.vehicle_id = q.vehicle_id AND q2.id <> q.id
               AND q2.mars_status = '전송완료' AND q2.mileage IS NOT NULL) AS posted_max,
           v.mars_vehicle_no, q.mars_order_no
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
           /**
            * 🔴 'NEW-…' 는 **우리가 붙인 임시 번호**다 (stock.ts:451 — 앱에서 손으로
            *    등록한 상품). MARS 마스터에는 없는 번호라 그대로 쳐 넣으면 줄이 깨진다.
            *    실제로 Q26-0812-008(박옥선)이 NEW-MSK5PTTT 로 **4번 연속 실패**하며
            *    고아 초안만 쌓았다 (2026-08-21 원인 규명).
            *    → 「품번 없음」으로 넘겨 사장님 지시(8/15)대로 범용 품번 S001/1290 으로
            *      들어가게 한다. 무엇을 팔았는지는 설명2(우리 품목명)에 그대로 남는다.
            */
           COALESCE(CASE WHEN p.mars_item_no LIKE 'NEW-%' THEN NULL ELSE p.mars_item_no END,
                    s.mars_service_no) AS no,
           -- ⚠️ MARS 원본 이름이 우선이다. 다듬은 이름으로는 MARS 에서 못 찾는다
           COALESCE(p.raw_name, s.name, qi.description) AS mars_name,
           qi.qty, qi.final_price, qi.line_type, qi.memo, p.list_price
    FROM quote_item qi
    LEFT JOIN product      p ON p.id = qi.product_id
    LEFT JOIN service_item s ON s.id = qi.service_item_id
    WHERE qi.quote_id IN ${sql.raw(`(${ids.join(",")})`)}
      -- 🔴 0원 부품 소모(use) 줄은 MARS 에 안 넣는다 (2026-08-11) — 넣으면 mars-fill 이
      --    「줄 부족」으로 실패한다. ⭐ 금액 있는 부품 줄은 넣는다 (2026-08-24) — 빼면
      --    MARS 합계가 앱 합계와 어긋난다. 품번은 위 COALESCE 규칙(NEW- → 범용)을 따른다.
      AND NOT (qi.line_type = 'use' AND qi.final_price = 0)
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
    postedMaxMileage: h.posted_max === null ? null : Number(h.posted_max),
    makerName: h.maker_name,
    year: h.year,
    fuelType: h.fuel_type,
    marsVehicleNo: h.mars_vehicle_no,
    marsOrderNo: h.mars_order_no,
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
  if (!(await (await import("./auth")).hasPerm("mars"))) return { ok: false, error: PERM_DENIED };
  /* 실제 일은 코어(mars-core.ts) — 매장 PC 로봇은 요청 밖(세션 없음)이라 게이트 없는
     코어를 직접 부른다 (2026-09-02 사고 수리 — cookies 예외로 로봇 5회 사망·MARS 중복 입력) */
  const { markEnteredCore } = await import("./mars-core");
  const r = await markEnteredCore(quoteId, refNo, memo);
  if (r.ok) refresh("/sales");
  return r;
}

/* ============================================================
 * ⭐ 아침 대사(對査) 대상 (2026-08-18 단계3, 사장님 승인 「매일 자동」)
 *
 * 앱의 전송완료 기록과 MARS 송장 목록을 검색으로 대조해, 틀린 기록을
 * **우리 DB 쪽만** 바로잡는다 — MARS 에는 아무것도 쓰지 않는다.
 * run#91 오기록 25건을 손으로 복구했던 일을 매일 아침 로봇이 한다.
 * ========================================================== */
export interface ReconcileTarget {
  quoteId: number;
  quoteNo: string;
  plateNo: string;
  workDate: string | null;
  total: number;
  /** 'SI번호' | '수동확인' | null */
  refNo: string | null;
  /** 메모에 「전기 실패」가 남아 있나 — 송장이 실재하면 문구를 정정한다 */
  staleFailMemo: boolean;
  /**
   * ⭐ '수동처리' 건인가 (사장님 결정 2026-08-21 — 「아침 대사가 확인하게 하기」).
   *    사람이 MARS 에서 직접 처리했다고 표시만 해 둔 건이라 송장 번호가 없다.
   *    대사가 송장을 찾아내면 「전송완료」로 올린다 — 못 찾으면 그대로 둔다.
   */
  manual: boolean;
}

export async function marsReconcileTargets(): Promise<ReconcileTarget[]> {
  const rows = await db.execute<{
    id: number;
    quote_no: string;
    plate_no: string;
    work_date: string | null;
    total_amount: number;
    mars_ref_no: string | null;
    stale: boolean;
    manual: boolean;
  }>(sql`
    SELECT q.id, q.quote_no, v.plate_no,
           COALESCE(q.work_date, q.created_at::date)::text work_date,
           q.total_amount, q.mars_ref_no,
           (q.mars_memo LIKE '%전기 실패%') stale,
           (q.mars_status = '수동처리') manual
    FROM quote q
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE q.status = '성사' AND q.quote_no LIKE 'Q%'
      AND v.plate_no IS NOT NULL
      AND (
        (q.mars_status = '전송완료'
          AND (q.mars_ref_no IS NULL OR q.mars_ref_no = '수동확인' OR q.mars_memo LIKE '%전기 실패%'))
        /**
         * ⭐ '수동처리' 도 대사가 본다 (사장님 결정 2026-08-21).
         *    「대기열에서 뺌 — MARS 직접 처리」라고만 적혀 있고 송장 번호가 없어,
         *    진짜 MARS 에 올라갔는지 우리 기록만으로는 알 수 없던 8건이다.
         *    읽기만 해서 사실을 확인하고, 찾으면 「전송완료」로 올린다.
         */
        OR q.mars_status = '수동처리'
      )
    ORDER BY q.id DESC
    LIMIT 60
  `);
  return rows.map((r) => ({
    quoteId: Number(r.id),
    quoteNo: r.quote_no,
    plateNo: r.plate_no,
    workDate: r.work_date,
    total: Number(r.total_amount),
    refNo: r.mars_ref_no,
    staleFailMemo: r.stale === true,
    manual: r.manual === true,
  }));
}

/**
 * ⭐ '수동처리'로 내려 둔 건에서 **송장이 실재함이 확인됐을 때** 「전송완료」로 올린다
 *    (사장님 결정 2026-08-21 — 대사가 확인하게 하기).
 *
 * 🔴 상태를 바꾸는 길은 이름이 있어야 한다. 떠돌이 UPDATE 로 상태를 흔들면
 *    나중에 누가 왜 바꿨는지 아무도 못 찾는다 — 그래서 함수로 못박고,
 *    **'수동처리' 인 것만** 건드린다.
 */
export async function promoteManualToPosted(quoteId: number, refNo: string): Promise<void> {
  await db.execute(sql`
    UPDATE quote
       SET mars_status = '전송완료', mars_ref_no = ${refNo}, updated_at = now(),
           mars_memo = COALESCE(mars_memo || ' · ', '')
             || '대사에서 송장 확인 — 전송완료로 올림 ('
             || to_char(now() AT TIME ZONE 'Asia/Seoul', 'MM/DD') || ')'
     WHERE id = ${quoteId} AND mars_status = '수동처리'
  `);
  refresh("/sales");
}

/**
 * 송장 번호는 이미 맞는데 메모에 「전기 실패」가 남은 건 — 대사가 송장 실재를
 * 확인한 뒤 문구만 정정한다 (saveMarsRefNo 는 ref 가 이미 있으면 안 건드리므로 별도)
 */
export async function cleanMarsFailMemo(quoteId: number): Promise<void> {
  await db.execute(sql`
    UPDATE quote SET updated_at = now(),
      mars_memo = regexp_replace(mars_memo, ' · 전기 실패:.*$', '')
        || ' · 전기 확인됨(대사, ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'MM/DD') || ')'
    WHERE id = ${quoteId} AND mars_memo LIKE '%전기 실패%'
  `);
  refresh("/sales");
}

/**
 * ⭐ 매출 주문(SO) 번호를 만들자마자 기록한다 (2026-08-18 단계2).
 *    중간에 죽어도 초안 번호가 남아 다음 시도가 이어서 쓴다 — 고아 초안 근절.
 */
export async function saveMarsOrderNo(quoteId: number, orderNo: string): Promise<void> {
  await db.execute(sql`
    UPDATE quote SET mars_order_no = ${orderNo}, updated_at = now() WHERE id = ${quoteId}
  `);
}

/** 초안을 MARS 에서 못 찾았을 때(지워졌을 때) 번호를 비운다 — 다음은 처음부터 */
export async function clearMarsOrderNo(quoteId: number): Promise<void> {
  await db.execute(sql`
    UPDATE quote SET mars_order_no = NULL, updated_at = now() WHERE id = ${quoteId}
  `);
}

/* ============================================================
 * ⭐ 시도별 단계 이력 (2026-08-18 단계2) — 상태 기계와 별개의 부가 기록.
 *    한 시도 = 한 줄. 단계가 나아갈 때마다 갱신한다. 실패하면 error 에 사유.
 * ========================================================== */
export async function startMarsAttempt(quoteId: number, marsRunId: number | null): Promise<number> {
  const [r] = await db.execute<{ id: number }>(sql`
    INSERT INTO mars_attempt (quote_id, mars_run_id) VALUES (${quoteId}, ${marsRunId}) RETURNING id
  `);
  return Number(r.id);
}

export async function stageMarsAttempt(
  attemptId: number,
  stage: string,
  extra?: { orderNo?: string | null; invoiceNo?: string | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE mars_attempt SET stage = ${stage},
      order_no = COALESCE(${extra?.orderNo ?? null}, order_no),
      invoice_no = COALESCE(${extra?.invoiceNo ?? null}, invoice_no)
    WHERE id = ${attemptId}
  `);
}

export async function endMarsAttempt(attemptId: number, error?: string | null): Promise<void> {
  await db.execute(sql`
    UPDATE mars_attempt SET finished_at = now(), error = ${error?.slice(0, 500) ?? null}
    WHERE id = ${attemptId}
  `);
}

/**
 * ⭐ 점검 실행이 송장 목록에서 알아낸 **송장 번호를 뒤늦게 채운다** (2026-08-15).
 *
 * 🔴 8/12 현금 3건이 「전기 미확인」으로 남아 있었는데, 점검 실행은 그 송장들을
 *    목록에서 찾아 놓고도(003225·003226·003228) 점검 기록만 맞추고 번호는 안
 *    적었다 — 감사 배너가 계속 울렸다. 번호가 비어 있거나 「수동확인」일 때만 채운다.
 */
export async function saveMarsRefNo(quoteId: number, refNo: string): Promise<void> {
  /**
   * 🔴 「전기 실패」 메모도 함께 정정한다 (2026-08-17 run#91 — 송장 목록이 날짜순이라
   *    과거 송장을 못 보고 25건을 「전기 실패」로 잘못 적었다. 뒤늦게 송장이
   *    확인됐는데 메모가 실패라고 우기면, 사장님이 믿고 수동 전기를 또 할 수 있다).
   */
  await db.execute(sql`
    UPDATE quote SET mars_ref_no = ${refNo}, updated_at = now(),
      mars_memo = CASE WHEN mars_memo LIKE '%전기 실패%'
        THEN regexp_replace(mars_memo, ' · 전기 실패:.*$', '') || ' · 전기 확인됨(송장 목록 검색, ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'MM/DD') || ')'
        ELSE mars_memo END
    WHERE id = ${quoteId} AND (mars_ref_no IS NULL OR mars_ref_no = '수동확인')
  `);
  refresh("/sales");
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
