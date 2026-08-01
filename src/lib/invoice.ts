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
import { parseInvoiceRows, parseInvoiceText, type ParsedInvoice } from "./invoice-parse";
import { isPlausibleDot } from "./normalize";
import { savePriceRule } from "./pricing";

/**
 * 인보이스 품번으로 우리 상품을 찾는다.
 *
 * 브랜드마다 번호 체계가 다르고, 우리 DB에는 접두가 붙어 있다.
 *   미쉐린   267623        → 그대로
 *   콘티넨탈 03580470000   → CO03580470000
 *   금호     2420132       → KM2420132
 * ⚠️ 접두를 고정하면 안 된다. **콘티넨탈 인보이스에 제네럴(GN) 제품이 섞여 온다.**
 *    실제로 04492050000(GRAB HT6)이 GN 으로 들어 있었다.
 */
async function matchProduct(code: string) {
  const [p] = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) pattern, p.list_price_excl excl
    FROM product p
    WHERE p.mars_item_no = ${code}
       OR p.barcode = ${code}
       OR p.mars_item_no = ${"CO" + code}
       OR p.mars_item_no = ${"KM" + code}
       OR p.mars_item_no LIKE ${"%" + code}
    ORDER BY (p.mars_item_no = ${code}) DESC
    LIMIT 1
  `);
  return p ?? null;
}

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

export interface PreviewResult {
  /** ⚠️ 한 파일에 인보이스가 여러 건 들어온다 */
  invoices: InvoicePreview[];
  /** 파일 전체에 대한 안내 */
  note: string | null;
}

/** ① 파일을 읽어 미리보기를 만든다. 아직 저장하지 않는다 */
export async function previewInvoice(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<PreviewResult | { error: string }> {
  let text = "";
  let excelRows: Record<string, unknown>[] | null = null;
  try {
    if (/\.pdf$/i.test(fileName)) {
      const { pdfToText } = await import("./pdf-text");
      text = await pdfToText(bytes);
    } else if (/\.xlsx?$/i.test(fileName)) {
      /**
       * 금호는 인보이스가 아니라 「발주내역조회」 엑셀이다. 표 그대로 읽는다.
       * CSV 로 눌러 읽으면 컬럼이 섞여 「합계」 행을 못 걸러낸다.
       */
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(bytes.slice(0)), { type: "array", cellDates: true });
      excelRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
        defval: null,
      });
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

  // 엑셀이 기본 경로다. PDF 는 엑셀을 못 받을 때만 쓴다
  const parsedList = excelRows ? parseInvoiceRows(excelRows) : parseInvoiceText(text);

  if (parsedList.length === 0) {
    return {
      error: excelRows
        ? "어느 브랜드 양식인지 알아보지 못했습니다. 미쉐린·콘티넨탈·금호 엑셀을 읽습니다."
        : "이 PDF 는 읽지 못했습니다. 사이트에서 **엑셀**로 내려받아 올려 주세요 — 훨씬 정확합니다.",
    };
  }

  const invoices: InvoicePreview[] = [];
  for (const parsed of parsedList) {
    const [dup] = parsed.invoiceNo
      ? await db
          .select({ id: purchaseInvoice.id })
          .from(purchaseInvoice)
          .where(eq(purchaseInvoice.invoiceNo, parsed.invoiceNo))
          .limit(1)
      : [];

    const matches: InvoicePreview["matches"] = [];
    for (const it of parsed.items) {
      const p = await matchProduct(it.cai);
      matches.push({
        cai: it.cai,
        productId: p?.id ?? null,
        model: p?.pattern ?? null,
        ourListPrice: p?.excl ?? null,
        // 기표가를 주는 것은 미쉐린뿐이다. 없는 브랜드는 비교할 것이 없다
        priceDiffers: !!p && it.unitListPrice > 0 && p.excl !== null && p.excl !== it.unitListPrice,
      });

      /**
       * ⭐ 할인율이 적힌 것은 미쉐린뿐이다.
       *    콘티넨탈·금호는 단가만 주므로 **우리 기표가로 역산**한다.
       *    이게 있어야 세 브랜드 모두 매입원가·마진이 나온다.
       */
      if (it.discountRate === 0 && p?.excl && p.excl > 0 && it.unitCost > 0) {
        it.unitListPrice = p.excl;
        it.discountRate = Math.max(0, Math.min(0.99, 1 - it.unitCost / p.excl));
        it.discountAmount = Math.round(p.excl * it.qty - it.supplyAmount);
      }
    }
    invoices.push({ ...parsed, duplicate: !!dup, matches });
  }

  const already = invoices.filter((i) => i.duplicate).length;
  return {
    invoices,
    note:
      invoices.length > 1
        ? `이 파일에 인보이스 ${invoices.length}건이 들어 있습니다${already ? ` (이미 등록된 것 ${already}건)` : ""}`
        : already
          ? "이미 등록된 인보이스입니다"
          : null,
  };
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
): Promise<
  { ok: true; saved: number; skipped: number; priceUpdates: number } | { ok: false; error: string }
> {
  const pv = await previewInvoice(fileName, bytes);
  if ("error" in pv) return { ok: false, error: pv.error };

  // 이미 올린 것은 건너뛴다. 한 파일에 새 것과 옛 것이 섞여 오기 때문이다
  const todo = pv.invoices.filter((i) => !i.duplicate && i.invoiceNo && i.items.length > 0);
  const skipped = pv.invoices.length - todo.length;
  if (todo.length === 0) {
    return { ok: false, error: skipped > 0 ? "전부 이미 등록된 인보이스입니다" : "저장할 것이 없습니다" };
  }

  let priceUpdates = 0;
  for (const one of todo) {
    const [inv] = await db
      .insert(purchaseInvoice)
      .values([
        {
          supplier: one.supplier,
          invoiceNo: one.invoiceNo,
          orderNo: one.orderNo,
          issuedAt: one.issuedAt,
          totalQty: one.totalQty,
          subtotal: one.subtotal,
          vat: one.vat,
          total: one.total,
          fileName,
          status: "입고대기",
        },
      ])
      .returning({ id: purchaseInvoice.id });

    await db.insert(purchaseInvoiceItem).values(
      one.items.map((it, i) => ({
        invoiceId: inv.id,
        cai: it.cai,
        productId: one.matches[i]?.productId ?? null,
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
    if (!opts.updatePrices) continue;
    for (const it of one.items) {
      if (it.discountRate <= 0) continue;
      await savePriceRule({ scope: "item", target: it.cai, purchaseRate: it.discountRate });
      priceUpdates++;
      /**
       * 기표가가 다르면 인보이스 쪽이 최신이다 (MARS 데이터는 낡을 수 있다).
       * ⚠️ 역산으로 채운 값은 우리 기표가 그대로라 갱신되지 않는다 — 의도한 대로다.
       */
      if (it.unitListPrice > 0) {
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
  }

  refresh("/", "/receiving");
  return { ok: true, saved: todo.length, skipped, priceUpdates };
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

export interface PendingInvoice {
  invoiceId: number;
  invoiceNo: string;
  supplier: string;
  issuedAt: string | null;
  status: string;
  lines: PendingLine[];
  /** 아직 안 온 수량 합 */
  remain: number;
}

/** 인보이스 단위로 묶어 준다 — 화면에서 한 건씩 통째로 다루기 위해 */
export async function pendingInvoices(): Promise<PendingInvoice[]> {
  const lines = await pendingLines();
  const map = new Map<number, PendingInvoice>();
  for (const l of lines) {
    const g =
      map.get(l.invoiceId) ??
      map
        .set(l.invoiceId, {
          invoiceId: l.invoiceId,
          invoiceNo: l.invoiceNo,
          supplier: l.supplier,
          issuedAt: l.issuedAt,
          status: "",
          lines: [],
          remain: 0,
        })
        .get(l.invoiceId)!;
    g.lines.push(l);
    g.remain += l.qty - l.receivedQty;
  }
  return [...map.values()];
}

/**
 * ⭐ 인보이스 품목 지우기 (사장님 요청 2026-08-01)
 *   타이어가 아닌 것이 섞여 오므로 목록에서 빼야 한다.
 *
 * ⚠️ 이미 입고된 것은 못 지운다. 재고가 이미 생겼기 때문에
 *    여기서 지우면 재고만 남고 근거가 사라진다.
 */
export async function removeInvoiceItem(itemId: number): Promise<{ ok: boolean; error?: string }> {
  const [line] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, itemId))
    .limit(1);
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  if (line.receivedQty > 0) {
    return { ok: false, error: "이미 입고된 품목입니다. 재고 화면에서 수량을 고쳐 주세요" };
  }
  await db.delete(purchaseInvoiceItem).where(eq(purchaseInvoiceItem.id, itemId));

  // 품목이 하나도 안 남으면 인보이스도 정리한다
  const [rest] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM purchase_invoice_item WHERE invoice_id = ${line.invoiceId}`,
  );
  if ((rest?.n ?? 0) === 0) {
    await db.delete(purchaseInvoice).where(eq(purchaseInvoice.id, line.invoiceId));
  }
  refresh("/receiving");
  return { ok: true };
}

/** 인보이스 통째로 지우기 — 잘못 올렸을 때 */
export async function removeInvoice(invoiceId: number): Promise<{ ok: boolean; error?: string }> {
  const [got] = await db.execute<{ received: number }>(
    sql`SELECT COALESCE(SUM(received_qty),0)::int received
        FROM purchase_invoice_item WHERE invoice_id = ${invoiceId}`,
  );
  if ((got?.received ?? 0) > 0) {
    return { ok: false, error: "이미 입고된 품목이 있어 지울 수 없습니다" };
  }
  await db.delete(purchaseInvoice).where(eq(purchaseInvoice.id, invoiceId));
  refresh("/receiving");
  return { ok: true };
}

/**
 * ⭐ 인보이스 정보로 상품 바로 만들기 (사장님 요청 2026-08-01)
 *
 * 신모델은 MARS 마스터에 아직 없다 (금호 HP72 등). 그런데 인보이스에는
 * 규격·모델명·기표가가 다 들어 있으므로 그대로 상품을 만들 수 있다.
 *
 * ⭐ 품번을 **MARS 규칙에 맞춰** 만든다 — 미쉐린은 그대로, 콘티넨탈 `CO…`, 금호 `KM…`.
 *    그래야 나중에 MARS 마스터를 다시 받았을 때 저절로 이어진다.
 *    아무 번호나 붙이면 그때 중복이 생긴다.
 */
export async function createProductFromInvoiceItem(
  itemId: number,
): Promise<{ ok: true; productId: number } | { ok: false; error: string }> {
  const [line] = await db.execute<{
    id: number;
    cai: string;
    description: string;
    unit_list_price: number | null;
    unit_cost: number | null;
    supplier: string;
    product_id: number | null;
  }>(sql`
    SELECT ii.id, ii.cai, ii.description, ii.unit_list_price, ii.unit_cost,
           i.supplier, ii.product_id
    FROM purchase_invoice_item ii JOIN purchase_invoice i ON i.id = ii.invoice_id
    WHERE ii.id = ${itemId}
  `);
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  if (line.product_id) return { ok: false, error: "이미 상품이 연결돼 있습니다" };

  const BRAND: Record<string, { code: string; prefix: string }> = {
    미쉐린: { code: "MI", prefix: "" },
    콘티넨탈: { code: "CO", prefix: "CO" },
    금호: { code: "KM", prefix: "KM" },
  };
  const b = BRAND[line.supplier];
  if (!b) return { ok: false, error: `${line.supplier} 은 아직 자동 등록을 지원하지 않습니다` };

  const marsItemNo = `${b.prefix}${line.cai}`;

  // 혹시 이미 있으면 잇기만 한다
  const [exists] = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.marsItemNo, marsItemNo))
    .limit(1);
  if (exists) {
    await db
      .update(purchaseInvoiceItem)
      .set({ productId: exists.id })
      .where(eq(purchaseInvoiceItem.id, itemId));
    refresh("/receiving");
    return { ok: true, productId: exists.id };
  }

  const { parseTireSpec } = await import("./tire-spec");
  const { parseTireName } = await import("./tire-name");
  const { parseTireAttrs } = await import("./tire-attrs");

  /**
   * ⚠️ 브랜드마다 자재명에 내부 코드가 섞여 온다.
   *    금호 `KH 245/60  R18 V04L HP72 8K;RK` — `KH`(브랜드) `V04L`·`8K;RK`(내부코드)
   *    이걸 그대로 모델명으로 쓰면 화면이 읽을 수 없게 된다.
   */
  const desc = line.description
    .replace(/;.*$/, " ") // `;RK` 뒤는 내부 코드
    .replace(/^\s*(KH|KM|CO|MI|BS|HK|NX|GY)\s+/i, " ") // 브랜드 접두
    .replace(/\s+/g, " ")
    .trim();

  const spec = parseTireSpec(desc);
  if (!spec.parsed) {
    return {
      ok: false,
      error: `규격을 읽지 못했습니다 («${line.description}»). 「새 상품 등록」에서 직접 넣어 주세요`,
    };
  }
  const name = parseTireName(desc, desc, spec);
  const attrs = parseTireAttrs(desc, desc);

  // 기표가 — 인보이스에 없으면 매입가로 대신 채워 둔다 (0 보다 낫다)
  const excl = line.unit_list_price && line.unit_list_price > 0 ? line.unit_list_price : line.unit_cost;
  const [brandRow] = await db.execute<{ vat: boolean }>(
    sql`SELECT price_excludes_vat vat FROM brand WHERE code = ${b.code}`,
  );
  const listPrice = excl ? (brandRow?.vat ? Math.round(excl * 1.1) : excl) : null;

  const [row] = await db
    .insert(product)
    .values([
      {
        marsItemNo,
        itemType: "tire",
        isSerialized: true,
        brandCode: b.code,
        pattern: name.model,
        // 원문은 손대지 않은 것을 남긴다 — 나중에 다시 읽을 수 있어야 한다
        rawName: line.description,
        width: spec.width,
        aspectRatio: spec.aspectRatio,
        rimInch: spec.rimInch !== null ? String(spec.rimInch) : null,
        loadIndex: spec.loadIndex,
        speedRating: spec.speedRating,
        season: attrs.season,
        isRunflat: attrs.isRunflat,
        isAcoustic: attrs.isAcoustic,
        isSuv: attrs.isSuv,
        category: "10-TIRES",
        barcode: marsItemNo,
        listPriceExcl: excl,
        listPrice,
        specParsed: true,
        stockTracked: false,
      },
    ])
    .returning({ id: product.id });

  await db
    .update(purchaseInvoiceItem)
    .set({ productId: row.id })
    .where(eq(purchaseInvoiceItem.id, itemId));

  refresh("/receiving", "/");
  return { ok: true, productId: row.id };
}

/**
 * ⭐ 남은 수량 전부 입고 (사장님 요청 2026-08-01)
 *   바코드를 찍지 않아도 한 번에 재고로 넘긴다.
 *   ⚠️ DOT 는 비워 둔다. 나중에 재고 화면에서 채울 수 있다 (D-02).
 */
export async function receiveAll(
  invoiceId: number,
  userId?: number,
): Promise<{ ok: true; created: number; failed: string[] } | { ok: false; error: string }> {
  const lines = (await pendingLines()).filter((l) => l.invoiceId === invoiceId);
  if (lines.length === 0) return { ok: false, error: "입고할 것이 없습니다" };

  let created = 0;
  const failed: string[] = [];
  for (const l of lines) {
    const remain = l.qty - l.receivedQty;
    if (remain <= 0) continue;
    const r = await receiveLine({ itemId: l.itemId, qty: remain, dot: null, userId });
    if (r.ok) created += r.created;
    else failed.push(`${l.model ?? l.cai}: ${r.error}`);
  }
  refresh("/receiving", "/");
  return { ok: true, created, failed };
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
