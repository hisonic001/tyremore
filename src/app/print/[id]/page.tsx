import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getShopInfo } from "@/lib/shop";
import { PrintFrame } from "./frame";

export const dynamic = "force-dynamic";

/**
 * ⭐ 견적서 · 거래명세서 인쇄 (사장님 요청 2026-08-05)
 *
 *   "정비내역을 통해서 견적서, 거래명세서를 바로 출력가능하게.
 *    공급자와 구매자의 정보, 정확한 품목 및 단가, 합계 금액 등이 명시."
 *
 * ?doc=estimate  → 견적서
 * ?doc=statement → 거래명세서 (기본)
 *
 * 금액 표기는 공급가액·세액 분리 (사장님 선택 2026-08-05) —
 * 우리 단가는 VAT 포함이므로 줄 합계에서 공급가액 = 합계÷1.1 로 나눈다.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const quoteId = Number(id);
  if (!Number.isInteger(quoteId)) notFound();
  const doc: "estimate" | "statement" = sp.doc === "estimate" ? "estimate" : "statement";

  const [head] = await db.execute<{
    quote_no: string;
    status: string;
    work_date: string;
    total_amount: number;
    payment_method: string | null;
    payment_memo: string | null;
    mars_memo: string | null;
    supplier_name: string | null;
    customer_name: string | null;
    phone: string | null;
    address: string | null;
    plate_no: string | null;
    maker_model: string | null;
    pay_split: string | null;
  }>(sql`
    SELECT q.quote_no, q.status, to_char(COALESCE(q.work_date, q.created_at::date), 'YYYY-MM-DD') work_date,
           q.total_amount, q.payment_method, q.payment_memo, q.mars_memo, q.supplier_name,
           -- 분할 결제 「카드 30,000 + 현금 5,000」 (2026-08-10)
           (SELECT string_agg(pm.method || ' ' || to_char(pm.amount, 'FM999,999,999'), ' + ' ORDER BY pm.id)
              FROM quote_payment pm WHERE pm.quote_id = q.id) pay_split,
           c.name customer_name, c.phone, c.address,
           v.plate_no,
           trim(COALESCE((SELECT name_ko FROM vehicle_maker m WHERE m.code = v.maker_code), v.maker_name, '') || ' ' || COALESCE(v.model, '')) maker_model
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    WHERE q.id = ${quoteId}
  `);
  if (!head) notFound();

  const lines = await db.execute<{
    description: string;
    line_type: string;
    qty: number;
    final_price: number;
    spec: string | null;
  }>(sql`
    SELECT qi.description, qi.line_type, qi.qty, qi.final_price,
           CASE WHEN p.width IS NOT NULL
                THEN p.width || '/' || COALESCE(p.aspect_ratio::text,'') || 'R' || COALESCE(round(p.rim_inch)::text,'')
                ELSE NULL END spec
    FROM quote_item qi
    LEFT JOIN product p ON p.id = qi.product_id
    WHERE qi.quote_id = ${quoteId}
    ORDER BY qi.line_type DESC, qi.id
  `);

  const shop = await getShopInfo();

  /**
   * 손님 이름이 없는 판매의 이름.
   * ⭐ 거래처는 제 컬럼에서 (2026-08-17). 비회원은 여전히 marsMemo 글자다.
   *    옛 건이 컬럼 없이 남아 있을 경우를 대비해 memo 파싱도 남겨 둔다.
   */
  const memoName =
    head.supplier_name ??
    (head.mars_memo?.startsWith("비회원") || head.mars_memo?.startsWith("거래처")
      ? head.mars_memo.replace(/^(비회원|거래처)\s*/, "").replace(/·.*$/, "").trim()
      : null);

  return (
    <PrintFrame
      doc={doc}
      shop={shop}
      head={{
        quoteNo: head.quote_no,
        workDate: head.work_date,
        customerName: head.customer_name ?? memoName ?? "고객",
        phone: head.phone,
        address: head.address,
        plateNo: head.plate_no,
        vehicle: head.maker_model?.trim() || null,
        paymentMethod: head.pay_split ?? head.payment_method,
        canceled: head.status === "취소",
      }}
      lines={lines.map((l) => ({
        description: l.description,
        spec: l.spec,
        isService: l.line_type === "service",
        qty: Number(l.qty),
        unitPrice: Number(l.final_price),
      }))}
    />
  );
}
