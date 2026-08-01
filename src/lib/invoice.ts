"use server";

/**
 * 매입 인보이스 — 업로드 · 저장 · 입고 확정
 *
 * 흐름
 *   ① 업로드 → 읽기 → **미리보기**(검산 결과 포함) → 사람이 확인
 *   ② 저장   → 입고 대기로 등록 + **매입 할인율·실매입가 자동 반영**
 *   ③ 도착   → 스캔하거나 수량 입력 → 재고 확정
 *
 * ⚠️ ①에서 바로 저장하지 않는다. 인보이스는 돈이고, 잘못 읽으면 매입원가가 통째로 틀어진다.
 *    검산이 어긋나면 사람이 봐야 한다.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product, purchaseInvoice, purchaseInvoiceItem, stockItem, stockMovement } from "@/db/schema";
import { parseInvoice, type ParsedInvoice } from "./invoice-parse";
import { isPlausibleDot } from "./normalize";
import { savePriceRule } from "./pricing";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface InvoicePreview extends ParsedInvoice {
  /** 이미 올린 인보이스인가 */
  duplicate: boolean;
  /** 품목별로 우리 DB와 대조한 결과 */
  matches: {
    cai: string;
    productId: number | null;
    model: string | null;
    /** 우리가 아는 기표가(VAT 미포함) */
    ourListPrice: number | null;
    /** 인보이스 기준단가와 다른가 — 다르면 인보이스가 최신이다 */
    priceDiffers: boolean;
  }[];
}

/** ① 파일을 읽어 미리보기를 만든다. 아직 저장하지 않는다 */
export async function previewInvoice(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<InvoicePreview | { error: string }> {
  let text = "";
  try {
    /**
     * ⚠️ 반드시 **복사본**을 넘긴다.
     *    pdf.js 는 넘긴 버퍼를 가져가 버려서(detach), 원본을 다시 쓰면
     *    "Cannot perform Construct on a detached ArrayBuffer" 로 깨진다.
     *    미리보기 → 저장으로 같은 파일을 두 번 읽는 흐름이라 실제로 문제가 됐다.
     */
    if (/\.pdf$/i.test(fileName)) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
      const r = await extractText(pdf, { mergePages: true });
      text = r.text;
    } else if (/\.xlsx?$/i.test(fileName)) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(bytes.slice(0)), { type: "array" });
      text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: " " })).join("\n");
    } else {
      return { error: "PDF 또는 엑셀 파일만 올릴 수 있습니다" };
    }
  } catch (e) {
    return { error: `파일을 읽지 못했습니다: ${(e as Error).message}` };
  }

  if (!text.trim()) {
    return {
      error:
        "글자를 찾지 못했습니다. 스캔한 이미지 PDF 같습니다 — 원본(텍스트) PDF 를 내려받아 올려 주세요.",
    };
  }

  const parsed = parseInvoice(text);

  const [dup] = parsed.invoiceNo
    ? await db
        .select({ id: purchaseInvoice.id })
        .from(purchaseInvoice)
        .where(eq(purchaseInvoice.invoiceNo, parsed.invoiceNo))
        .limit(1)
    : [];

  // CAI 로 상품을 찾는다
  const matches: InvoicePreview["matches"] = [];
  for (const it of parsed.items) {
    const [p] = await db
      .select({
        id: product.id,
        pattern: product.pattern,
        displayName: product.displayName,
        excl: product.listPriceExcl,
      })
      .from(product)
      .where(eq(product.marsItemNo, it.cai))
      .limit(1);
    matches.push({
      cai: it.cai,
      productId: p?.id ?? null,
      model: p?.displayName ?? p?.pattern ?? null,
      ourListPrice: p?.excl ?? null,
      priceDiffers: !!p && p.excl !== null && p.excl !== it.unitListPrice,
    });
  }

  return { ...parsed, duplicate: !!dup, matches, rawTextLength: text.length } as InvoicePreview;
}

/**
 * ② 저장 — 입고 대기로 등록한다.
 *
 * ⭐ 이때 **매입 할인율과 기표가를 함께 갱신**한다. 인보이스가 가장 정확한 자료다.
 */
export async function saveInvoice(
  fileName: string,
  bytes: ArrayBuffer,
  opts: { updatePrices: boolean },
): Promise<{ ok: true; invoiceId: number; priceUpdates: number } | { ok: false; error: string }> {
  const pv = await previewInvoice(fileName, bytes);
  if ("error" in pv) return { ok: false, error: pv.error };
  if (!pv.invoiceNo) return { ok: false, error: "발행번호를 찾지 못해 저장할 수 없습니다" };
  if (pv.duplicate) return { ok: false, error: `이미 올린 인보이스입니다 (${pv.invoiceNo})` };
  if (pv.items.length === 0) return { ok: false, error: "품목을 하나도 읽지 못했습니다" };

  const [inv] = await db
    .insert(purchaseInvoice)
    .values([
      {
        supplier: pv.supplier,
        invoiceNo: pv.invoiceNo,
        orderNo: pv.orderNo,
        issuedAt: pv.issuedAt,
        totalQty: pv.totalQty,
        subtotal: pv.subtotal,
        vat: pv.vat,
        total: pv.total,
        fileName,
        status: "입고대기",
      },
    ])
    .returning({ id: purchaseInvoice.id });

  await db.insert(purchaseInvoiceItem).values(
    pv.items.map((it, i) => ({
      invoiceId: inv.id,
      cai: it.cai,
      productId: pv.matches[i]?.productId ?? null,
      description: it.description,
      qty: it.qty,
      unitListPrice: it.unitListPrice,
      discountRate: String(it.discountRate),
      supplyAmount: it.supplyAmount,
      unitCost: it.unitCost,
    })),
  );

  /**
   * ⭐ 매입 할인율·기표가 갱신 — 사장님이 수기로 넣을 일이 없어진다.
   * 인보이스는 실제로 돈이 오간 근거라 어떤 자료보다 정확하다.
   */
  let priceUpdates = 0;
  if (opts.updatePrices) {
    for (const it of pv.items) {
      await savePriceRule({ scope: "item", target: it.cai, purchaseRate: it.discountRate });
      priceUpdates++;
      // 기준단가가 다르면 인보이스 쪽이 최신이다 (MARS 데이터는 낡을 수 있다)
      await db.execute(sql`
        UPDATE product SET
          list_price_excl = ${it.unitListPrice},
          list_price = CASE WHEN (SELECT price_excludes_vat FROM brand b WHERE b.code = product.brand_code)
                            THEN round(${it.unitListPrice} * 1.1)::int
                            ELSE ${it.unitListPrice} END,
          updated_at = now()
        WHERE mars_item_no = ${it.cai}
          AND (list_price_excl IS DISTINCT FROM ${it.unitListPrice})
      `);
    }
  }

  refresh("/", "/receiving");
  return { ok: true, invoiceId: inv.id, priceUpdates };
}

/* ============================================================
 * ③ 입고 확정
 * ========================================================== */

export interface PendingLine {
  itemId: number;
  invoiceId: number;
  invoiceNo: string;
  supplier: string;
  issuedAt: string | null;
  cai: string;
  productId: number | null;
  description: string;
  model: string | null;
  spec: string | null;
  qty: number;
  receivedQty: number;
  unitCost: number | null;
}

/** 아직 다 안 들어온 인보이스 품목 */
export async function pendingLines(): Promise<PendingLine[]> {
  const rows = await db.execute<{
    item_id: number;
    invoice_id: number;
    invoice_no: string;
    supplier: string;
    issued_at: string | null;
    cai: string;
    product_id: number | null;
    description: string;
    pattern: string | null;
    display_name: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
    qty: number;
    received_qty: number;
    unit_cost: number | null;
  }>(sql`
    SELECT ii.id item_id, i.id invoice_id, i.invoice_no, i.supplier, i.issued_at,
           ii.cai, ii.product_id, ii.description, p.pattern, p.display_name,
           p.width, p.aspect_ratio, p.rim_inch,
           ii.qty, ii.received_qty, ii.unit_cost
    FROM purchase_invoice_item ii
    JOIN purchase_invoice i ON i.id = ii.invoice_id
    LEFT JOIN product p ON p.id = ii.product_id
    WHERE i.status <> '취소' AND ii.received_qty < ii.qty
    ORDER BY i.issued_at DESC, ii.id
  `);

  return rows.map((r) => ({
    itemId: r.item_id,
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    supplier: r.supplier,
    issuedAt: r.issued_at,
    cai: r.cai,
    productId: r.product_id,
    description: r.description,
    model: r.display_name ?? r.pattern,
    spec:
      r.width && r.aspect_ratio && r.rim_inch
        ? `${r.width}/${r.aspect_ratio}R${Number(r.rim_inch)}`
        : null,
    qty: r.qty,
    receivedQty: r.received_qty,
    unitCost: r.unit_cost,
  }));
}

/**
 * 도착한 물건을 재고로 확정한다.
 *
 * ⚠️ 타이어는 1본 1행이다 (D-02). DOT 는 인보이스에 없으므로 여기서 받는다.
 *    모르면 비워도 된다 — 나중에 재고 화면에서 채울 수 있다.
 */
export async function receiveLine(input: {
  itemId: number;
  qty: number;
  dot?: string | null;
  userId?: number;
}): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const dot = input.dot?.trim() || null;
  if (dot && !isPlausibleDot(dot)) {
    return { ok: false, error: `DOT '${dot}' 를 확인해 주세요 (주차 01~53, 최근 15년)` };
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, error: "수량을 확인해 주세요" };
  }

  const [line] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, input.itemId))
    .limit(1);
  if (!line) return { ok: false, error: "인보이스 품목을 찾을 수 없습니다" };
  if (!line.productId) {
    return { ok: false, error: `상품을 찾지 못했습니다 (CAI ${line.cai}). 먼저 상품을 등록하세요` };
  }
  const remain = line.qty - line.receivedQty;
  if (input.qty > remain) {
    return { ok: false, error: `남은 수량은 ${remain}본입니다` };
  }

  // 재고번호 채번
  const yy = String(new Date().getFullYear()).slice(2);
  const [seqRow] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(stock_no, '^S\\d{2}-', ''), '')::bigint), 0)::int + 1 AS n
    FROM stock_item WHERE stock_no LIKE ${"S" + yy + "-%"}
  `);
  const start = seqRow?.n ?? 1;

  const values = Array.from({ length: input.qty }, (_, i) => ({
    stockNo: `S${yy}-${String(start + i).padStart(6, "0")}`,
    productId: line.productId!,
    qty: 1,
    status: "재고",
    dot,
    /** ⭐ 실매입가를 재고에 박아 둔다 — 나중에 원가를 정확히 되짚을 수 있다 */
    purchasePrice: line.unitCost,
    verifiedAt: new Date(),
    createdBy: input.userId ?? null,
  }));

  const inserted = await db.insert(stockItem).values(values).returning({ id: stockItem.id });
  await db.insert(stockMovement).values(
    inserted.map((r) => ({
      stockItemId: r.id,
      type: "입고",
      reason: "매입입고",
      qtyDelta: 1,
      memo: `인보이스 ${line.cai}`,
      createdBy: input.userId ?? null,
    })),
  );

  await db
    .update(purchaseInvoiceItem)
    .set({ receivedQty: line.receivedQty + input.qty })
    .where(eq(purchaseInvoiceItem.id, line.id));

  // 상품을 「미등록」에서 풀어 준다 (D-12 6번)
  await db.update(product).set({ stockTracked: true }).where(eq(product.id, line.productId));

  // 인보이스 상태 갱신
  await db.execute(sql`
    UPDATE purchase_invoice SET
      status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM purchase_invoice_item x
                         WHERE x.invoice_id = ${line.invoiceId} AND x.received_qty < x.qty)
        THEN '입고완료'
        WHEN EXISTS (SELECT 1 FROM purchase_invoice_item x
                     WHERE x.invoice_id = ${line.invoiceId} AND x.received_qty > 0)
        THEN '부분입고'
        ELSE '입고대기' END,
      updated_at = now()
    WHERE id = ${line.invoiceId}
  `);

  refresh("/receiving", "/", `/stock/${line.productId}`);
  return { ok: true, created: input.qty };
}
