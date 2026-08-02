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
 * 🔴 전기(Posting)는 자동화하지 않는다 (D-08). 사람이 화면 보고 누른다.
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
  total: number;
  memo: string | null;
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
  }>(sql`
    SELECT q.id, q.quote_no, q.confirmed_at, q.payment_method, q.total_amount, q.mars_memo,
           c.mars_contact_no AS contact_no, c.name AS customer_name, c.phone,
           c.address, c.consent_privacy, c.consent_marketing, c.consent_signed_at,
           v.plate_no, v.model AS vehicle_model, v.maker_name, v.year, v.fuel_type, v.mileage
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
    no: string | null;
    mars_name: string;
    qty: number;
    final_price: number;
    line_type: string;
  }>(sql`
    SELECT qi.quote_id,
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
    paymentMethod: h.payment_method,
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
 * @param refNo MARS 매출주문·송장 번호를 적어 두면 나중에 대조할 수 있다
 */
export async function markEntered(
  quoteId: number,
  refNo?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db.select({ id: quote.id }).from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };

  await db
    .update(quote)
    .set({
      marsStatus: "전송완료",
      marsSyncedAt: new Date(),
      marsRefNo: refNo?.trim() || null,
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
    .set({ marsStatus: "미전송", marsSyncedAt: null, marsRefNo: null, updatedAt: new Date() })
    .where(eq(quote.id, quoteId));
  refresh("/mars");
  return { ok: true };
}

/** 오늘 친 것 — 되돌릴 때 쓴다 */
export async function marsDone(): Promise<
  { quoteId: number; quoteNo: string; customerName: string | null; total: number; refNo: string | null }[]
> {
  const rows = await db
    .select({
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      total: quote.totalAmount,
      refNo: quote.marsRefNo,
      customerName: sql<string | null>`(SELECT name FROM customer c WHERE c.id = ${quote.customerId})`,
    })
    .from(quote)
    .where(sql`${quote.marsStatus} = '전송완료' AND ${quote.marsSyncedAt} > now() - interval '2 days'`)
    .orderBy(desc(quote.marsSyncedAt))
    .limit(20);
  return rows;
}
