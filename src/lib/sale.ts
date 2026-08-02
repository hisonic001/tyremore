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

export interface SuggestedService {
  serviceItemId: number;
  marsNo: string | null;
  name: string;
  price: number;
  qty: number;
  qtyRule: string;
  why: string;
}

/**
 * ⭐ 타이어를 담으면 공임·밸런스를 알아서 올린다.
 *
 * 빼는 것은 쉽고 넣는 것은 잊는다 (D-11 6번).
 * 인치에 따라 요금이 다르고, 휠밸런스는 **2개당**이라 사람이 매번 틀린다 —
 * MARS 서비스 목록에 「휠밸런스 - 타이어 2개당」이라고 적혀 있는 그대로다.
 */
export async function suggestServices(
  tires: { rimInch: number | null; qty: number }[],
): Promise<SuggestedService[]> {
  const totalQty = tires.reduce((s, t) => s + t.qty, 0);
  if (totalQty === 0) return [];
  const maxRim = Math.max(...tires.map((t) => t.rimInch ?? 0));

  const rows = await db
    .select({
      id: serviceItem.id,
      no: serviceItem.marsServiceNo,
      name: serviceItem.name,
      price: serviceItem.price,
      rule: serviceItem.qtyRule,
    })
    .from(serviceItem)
    .where(and(eq(serviceItem.isTireRelated, true), eq(serviceItem.autoSuggest, true), eq(serviceItem.isActive, true)));

  /** 이름에 적힌 인치 조건을 읽어 지금 규격에 맞는 것 하나만 고른다 */
  const pick = (kind: "교환" | "밸런스"): (typeof rows)[number] | null => {
    const group = rows.filter((r) =>
      kind === "교환" ? /교환/.test(r.name) && !/밸런스/.test(r.name) : /밸런스/.test(r.name),
    );
    if (group.length === 0) return null;
    // 「17인치 이하」·「18인치 이상」·「21인치 이상」 → 조건에 맞는 것 중 가장 비싼 것
    const fit = group.filter((r) => {
      const below = /(\d{2})\s*인치\s*이하/.exec(r.name);
      const above = /(\d{2})\s*인치\s*이상/.exec(r.name);
      if (below) return maxRim <= Number(below[1]);
      if (above) return maxRim >= Number(above[1]);
      return true;
    });
    const cand = fit.length ? fit : group;
    return cand.reduce((a, b) => ((b.price ?? 0) > (a.price ?? 0) ? b : a));
  };

  const out: SuggestedService[] = [];
  for (const kind of ["교환", "밸런스"] as const) {
    const s = pick(kind);
    if (!s) continue;
    const qty =
      s.rule === "per_unit" ? totalQty : s.rule === "per_2_units" ? Math.ceil(totalQty / 2) : 1;
    out.push({
      serviceItemId: s.id,
      marsNo: s.no,
      name: s.name,
      price: s.price ?? 0,
      qty,
      qtyRule: s.rule,
      why:
        s.rule === "per_2_units"
          ? `${totalQty}본 → 2개당 ${qty}회`
          : s.rule === "per_unit"
            ? `${totalQty}본`
            : "1회",
    });
  }
  return out;
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
