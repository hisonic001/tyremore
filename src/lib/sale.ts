"use server";

/**
 * ⭐ 판매 등록 (사장님 요청 2026-08-02)
 *
 *   "우리 가게에서 현재 진행하는 판매등록 순서를 말해줄게.
 *    차량 점검 및 주문 보고서 수기로 작성 → MARS에 수기로 입력.
 *    이 과정을 더 편하고 자동화를 만들고 싶어.
 *    특히나 MARS 입력은 제발 자동화가 되었으면 좋겠어."
 *
 * 이 화면 하나가 종이 「차량 점검 및 주문 보고서」의 **작업 내역 및 견적** 칸을 대신한다.
 * 저장하면 세 가지가 한꺼번에 일어난다:
 *   ① 판매 기록 (quote) 남김
 *   ② 재고 차감 — 오래된 DOT 부터 (선입선출)
 *   ③ MARS 입력 대기열에 올라감
 *
 * 🔴 MARS 전기(Posting)는 여전히 사람이 누른다. 자동화하지 않는다 (D-08).
 *    대기열은 「무엇을 어떤 순서로 칠지」를 보여줄 뿐이다.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customer, quote, quoteItem, serviceItem, stockItem, stockMovement, vehicle } from "@/db/schema";
import type { NewCustomerInput } from "./sale-types";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface SaleLine {
  kind: "tire" | "service" | "custom";
  productId?: number | null;
  serviceItemId?: number | null;
  /** 화면·MARS 표시용. 상품명이 나중에 바뀌어도 그때 판 이름이 남는다 */
  description: string;
  /** ⚠️ MARS 입력용 원본 이름 — 화면 정리와 무관하다 (D-08) */
  marsName?: string | null;
  /** MARS 품번 / 서비스 번호 */
  marsNo?: string | null;
  qty: number;
  listPrice?: number | null;
  salesRate?: number | null;
  /** 실제 판매 단가 (VAT 포함) */
  unitPrice: number;
}

export interface SaleInput {
  vehicleId?: number | null;
  customerId?: number | null;
  /** 회원이 아닌 손님 — 이름·전화만 적어 둔다 */
  walkIn?: { name?: string; phone?: string; plateNo?: string } | null;
  lines: SaleLine[];
  paymentMethod?: string | null;
  memo?: string | null;
  /** 주행거리를 적어 주면 차량 기록을 갱신한다 */
  mileage?: number | null;
  /**
   * ⭐ 실제로 정비한 날 (사장님 지시 2026-08-02).
   * 안 적으면 오늘. MARS 매출 주문의 문서 날짜·완료 일자로 들어간다.
   */
  workDate?: string | null;
}

/** 오늘 (YYYY-MM-DD) */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Q26-0802-001 */
async function nextQuoteNo(): Promise<string> {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${String(now.getFullYear()).slice(2)}-${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(right(quote_no, 3)::int), 0) + 1 AS n
    FROM quote WHERE quote_no LIKE ${`Q${day}-%`}
  `);
  return `Q${day}-${String(r?.n ?? 1).padStart(3, "0")}`;
}

/**
 * ⭐ 재고 차감 — **오래된 DOT 부터** 뺀다.
 *    새 타이어를 먼저 팔면 오래된 것이 창고에 남아 늙는다.
 *    DOT 이 없는 것은 언제 들어왔는지 모르므로 가장 먼저 내보낸다.
 */
async function sellFromStock(productId: number, qty: number, quoteId: number, userId?: number) {
  const rows = await db
    .select({ id: stockItem.id, qty: stockItem.qty, dot: stockItem.dot })
    .from(stockItem)
    .where(and(eq(stockItem.productId, productId), eq(stockItem.status, "재고")))
    .orderBy(sql`${stockItem.dot} ASC NULLS FIRST`, asc(stockItem.receivedAt));

  let left = qty;
  const now = new Date();
  const soldIds: number[] = [];

  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.qty, left);
    left -= take;

    await db.insert(stockMovement).values({
      stockItemId: r.id,
      type: "출고",
      reason: "판매",
      qtyDelta: -take,
      quoteId,
      createdBy: userId ?? null,
    });

    if (take === r.qty) {
      soldIds.push(r.id);
    } else {
      // 부품은 한 행에 여러 개가 들어 있다 — 수량만 줄인다
      await db.update(stockItem).set({ qty: r.qty - take }).where(eq(stockItem.id, r.id));
    }
  }

  if (soldIds.length) {
    await db
      .update(stockItem)
      .set({ status: "판매완료", soldAt: now, quoteId })
      .where(inArray(stockItem.id, soldIds));
  }

  /**
   * 재고보다 많이 팔았다 — 막지 않는다.
   * 실제로 재고 수량이 틀린 경우가 훨씬 흔하고, 손님을 앞에 두고
   * 「재고가 없다」며 판매를 못 하게 하면 프로그램을 안 쓰게 된다.
   * 대신 얼마나 모자랐는지 돌려준다.
   */
  return { short: left };
}

export async function saveSale(
  input: SaleInput,
): Promise<{ ok: true; quoteId: number; quoteNo: string; shortages: string[] } | { ok: false; error: string }> {
  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) return { ok: false, error: "판매할 품목이 없습니다" };

  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  /** 회원이 아닌 손님도 이름·전화가 있으면 남겨 둔다 — 다음에 오시면 이어진다 */
  let customerId = input.customerId ?? null;
  if (!customerId && input.walkIn?.phone?.replace(/\D/g, "").length) {
    const phone = input.walkIn.phone.replace(/\D/g, "");
    const [found] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(sql`replace(replace(${customer.phone},'-',''),' ','') = ${phone}`)
      .limit(1);
    customerId = found?.id ?? null;
  }

  const quoteNo = await nextQuoteNo();
  const now = new Date();

  const [q] = await db
    .insert(quote)
    .values({
      quoteNo,
      customerId,
      vehicleId: input.vehicleId ?? null,
      status: "성사",
      confirmedAt: now,
      workDate: input.workDate?.trim() || todayISO(),
      totalAmount: total,
      paymentMethod: input.paymentMethod ?? null,
      paidAmount: total,
      paymentMemo: input.memo ?? null,
      marsStatus: "미전송",
      marsMemo: input.walkIn?.name
        ? `비회원 ${input.walkIn.name}${input.walkIn.phone ? ` ${input.walkIn.phone}` : ""}${
            input.walkIn.plateNo ? ` ${input.walkIn.plateNo}` : ""
          }`
        : null,
    })
    .returning({ id: quote.id });

  await db.insert(quoteItem).values(
    lines.map((l) => ({
      quoteId: q.id,
      lineType: l.kind,
      productId: l.productId ?? null,
      serviceItemId: l.serviceItemId ?? null,
      description: l.description,
      qty: l.qty,
      listPrice: l.listPrice ?? null,
      salesDiscountRate: l.salesRate !== null && l.salesRate !== undefined ? String(l.salesRate) : null,
      finalPrice: l.unitPrice,
    })),
  );

  // 재고 차감 — 타이어·부품만
  const shortages: string[] = [];
  for (const l of lines) {
    if (!l.productId) continue;
    const { short } = await sellFromStock(l.productId, l.qty, q.id);
    if (short > 0) shortages.push(`${l.description} ${short}본`);
  }

  // 주행거리를 적어 주셨으면 차량 기록을 갱신한다
  if (input.vehicleId && input.mileage && input.mileage > 0) {
    await db
      .update(vehicle)
      .set({ mileage: input.mileage, lastVisitAt: now })
      .where(eq(vehicle.id, input.vehicleId));
  }

  refresh("/sale", "/mars", "/");
  return { ok: true, quoteId: q.id, quoteNo, shortages };
}

/* ------------------------------------------------------------------ */

/**
 * 🔴 공임·밸런스 자동 추천은 **없앴다** (사장님 지시 2026-08-02).
 *
 *   "타이어를 입력하면 자동으로 휠타이어 교환이나 휠밸런스가 올라가는데
 *    그럴 필요 없음. 그냥 타이어 값에 보통 포함되거든."
 *
 * 처음엔 D-11 6번(「빼는 것은 쉽고 넣는 것은 잊는다」)을 근거로 자동으로 올렸는데,
 * 매장 실제와 달랐다. 공임은 보통 타이어 값에 포함되어 따로 청구하지 않는다.
 * 따로 받으실 때만 화면의 「공임·정비 추가」로 넣으시면 된다.
 *
 * ⚠️ MARS 서비스 목록의 「2개당」 규칙(`qty_rule = per_2_units`)은 그대로 남아 있다.
 *    나중에 다시 필요해지면 그 값으로 계산하면 된다 —
 *    휠밸런스는 4본이면 2회다.
 */

/* ------------------------------------------------------------------ */

/**
 * ⭐ MARS 가 새 고객·차량에 요구하는 항목 (사장님 지적 2026-08-02)
 *
 *   "신규고객과 차량의 경우에는 필수로 넣어야 등록이 되는 정보들이 있음."
 *
 * MARS-auto-register 의 `process_customer_form` / `process_vehicle_form` 에서 확인:
 *   고객 — 이름 · 주소 · 휴대폰 번호 · 동의 3종 · 고객 서명
 *   차량 — 번호판 · 차량 종류(영문) · 제조사 · 모델 · 차량 연도 · 주행거리 · 등록 날짜
 *
 * 종이 「차량 점검 및 주문 보고서」에 있는 칸과 같다. 그 종이를 대신하는 것이므로
 * 여기서 다 받아 두면 MARS 에 그대로 넘길 수 있다.
 */
export async function createCustomerAndVehicle(
  input: NewCustomerInput,
): Promise<{ ok: true; customerId: number; vehicleId: number } | { ok: false; error: string }> {
  const name = input.name.trim();
  const plateNo = input.plateNo.trim();
  if (!name) return { ok: false, error: "이름을 넣어 주세요" };
  if (!plateNo) return { ok: false, error: "차량번호를 넣어 주세요" };
  if (!input.address.trim()) return { ok: false, error: "주소를 넣어 주세요 (MARS 필수 항목입니다)" };
  if (!input.fuelType) return { ok: false, error: "연료를 골라 주세요 (MARS 필수 항목입니다)" };

  const plateNorm = plateNo.replace(/[\s-]/g, "");
  const phone = input.phone.replace(/[^\d]/g, "");

  // 같은 번호판이 이미 있으면 그것을 쓴다 — 중복 차량을 만들지 않는다
  const [dupV] = await db
    .select({ id: vehicle.id, customerId: vehicle.customerId })
    .from(vehicle)
    .where(eq(vehicle.plateNoNorm, plateNorm))
    .limit(1);
  if (dupV) return { ok: true, customerId: dupV.customerId, vehicleId: dupV.id };

  // 같은 전화번호가 있으면 그 손님의 차량으로 붙인다
  let customerId: number | null = null;
  if (phone.length >= 9) {
    const [dupC] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(sql`replace(replace(${customer.phone},'-',''),' ','') = ${phone}`)
      .limit(1);
    customerId = dupC?.id ?? null;
  }

  const now = new Date();
  if (!customerId) {
    const [c] = await db
      .insert(customer)
      .values({
        name,
        nameSearch: name.replace(/\s/g, "").toLowerCase(),
        phone: input.phone.trim() || null,
        address: input.address.trim(),
        consentPrivacy: input.consentPrivacy,
        consentMarketing: input.consentMarketing,
        michelinMember: input.michelinMember,
        /** 서명을 받았을 때만 시각을 남긴다 — 이게 없으면 MARS 로 안 넘어간다 */
        consentSignedAt: input.signed ? now : null,
        type: "개인",
      })
      .returning({ id: customer.id });
    customerId = c.id;
  }

  const year = Number(input.year.replace(/\D/g, "")) || null;
  const [v] = await db
    .insert(vehicle)
    .values({
      customerId,
      plateNo,
      plateNoNorm: plateNorm,
      makerName: input.makerName.trim() || null,
      model: input.model.trim() || null,
      year,
      fuelType: input.fuelType,
      bodyType: input.bodyType || null,
      vin: input.vin.trim() || null,
      mileage: Number(input.mileage.replace(/\D/g, "")) || null,
      mileageAt: input.mileage ? now : null,
    })
    .returning({ id: vehicle.id });

  refresh("/sale", "/mars");
  return { ok: true, customerId, vehicleId: v.id };
}

/** 서비스·공임 찾기 (직접 추가용) */
export async function findServices(q: string): Promise<
  { id: number; marsNo: string | null; name: string; price: number | null; qtyRule: string }[]
> {
  const t = q.trim();
  const rows = await db
    .select({
      id: serviceItem.id,
      marsNo: serviceItem.marsServiceNo,
      name: serviceItem.name,
      price: serviceItem.price,
      qtyRule: serviceItem.qtyRule,
    })
    .from(serviceItem)
    .where(
      t
        ? and(eq(serviceItem.isActive, true), sql`${serviceItem.name} ILIKE ${"%" + t + "%"}`)
        : and(eq(serviceItem.isActive, true), eq(serviceItem.isFavorite, true)),
    )
    .orderBy(serviceItem.name)
    .limit(30);
  return rows;
}
