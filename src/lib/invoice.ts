"use server";

/**
 * 매입 인보이스 — 업로드 · 저장 · 입고 확정
 *
 * 흐름
 *   ① 업로드 → 읽기 → **미리보기**(검산 결과 포함) → 사람이 확인
 *   ② 저장   → 입고 대기로 등록 + **매입 할인율·실매입가 자동 반영**
 *   ③ 도착   → 수량을 넣거나 「전량 입고」 → 재고 확정
 *
 * ⚠️ ①에서 바로 저장하지 않는다. 인보이스는 돈이고, 잘못 읽으면 매입원가가 통째로 틀어진다.
 *    검산이 어긋나면 사람이 봐야 한다.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db";
import { product, purchaseInvoice, purchaseInvoiceItem, stockItem, stockMovement } from "@/db/schema";
import type { LineKind } from "./invoice-desc";
import { parseInvoiceRows, parseInvoiceText, type ParsedInvoice } from "./invoice-parse";
import { isPlausibleDot } from "./normalize";
import { isOwner } from "./auth";
// 권한 없는 내부용 — 정비사가 인보이스를 올려도 할인율 갱신이 끊기지 않게 (2026-08-08)
import { savePriceRuleCore } from "./pricing-core";

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
const BRAND_CODE: Record<string, string> = { 미쉐린: "MI", 콘티넨탈: "CO", 금호: "KM" };

type Matched = { id: number; pattern: string | null; excl: number | null; via: "품번" | "규격+모델" };

/**
 * 인보이스 한 줄이 우리 상품 표의 어느 것인지 찾는다.
 *
 * ① 품번으로 (가장 확실하다)
 * ② ⭐ 못 찾으면 **규격 + 모델코드**로 (사장님 지적 2026-08-03)
 *
 * 🔴 예전에는 ①만 했다. 그래서 같은 타이어가 카탈로그에 **다른 품번**으로 들어 있으면
 *    "이미 있는데도 못 알아본다". 실제로 금호는 한 카탈로그 안에 `KM2170042` 와
 *    `180/001/00024` 두 형태가 섞여 있다.
 *
 * ⚠️ ②에서 후보가 **둘 이상이면 고르지 않는다.** 매입원가가 엉뚱한 상품에 붙으면
 *    마진이 통째로 틀어진다. 애매하면 사람이 고르는 편이 낫다.
 */
async function matchProduct(code: string, description = "", supplier = ""): Promise<Matched | null> {
  /**
   * ⓪ ⭐ 거래처 품번 사전 (2026-08-04)
   *    금호 자재코드 `2387392` ←→ 우리 `KM2284552` 처럼 품번 체계가 아예 다른 경우.
   *    사장님이 「금호 상품목록」을 올리시면 여기가 채워진다 (`/settings/products`).
   *    사람이 확인해 이어 둔 값이므로 **품번보다 먼저 본다.**
   */
  if (supplier) {
    const [dict] = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) pattern, p.list_price_excl excl
      FROM supplier_item_code s JOIN product p ON p.id = s.product_id
      WHERE s.supplier = ${supplier} AND s.code = ${code}
      LIMIT 1`);
    if (dict) return { ...dict, via: "품번" };
  }

  const [byCode] = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) pattern, p.list_price_excl excl
    FROM product p
    WHERE p.mars_item_no = ${code}
       OR p.mars_item_no = ${"CO" + code}
       OR p.mars_item_no = ${"KM" + code}
       OR p.mars_item_no LIKE ${"%" + code}
    ORDER BY (p.mars_item_no = ${code}) DESC
    LIMIT 1
  `);
  if (byCode) return { ...byCode, via: "품번" };

  /**
   * ⭐ 금호는 **자재 마스터**(kumho_material)까지 본다 (사장님 요청 2026-08-27 —
   *    "금호는 이제 자재코드가 있으므로 딱딱 들어맞아야함").
   *    금호가 같은 타이어에 새 코드를 매기면 품번으로는 못 찾는다. 자재 마스터의
   *    규격+패턴+하중속도로 딱 하나면 이어 주고 사전에 적어 둔다(옛 코드도 남는다).
   *    미쉐린의 CAI 와 같은 자리다.
   */
  if (supplier === "금호") {
    const { resolveKumhoProduct } = await import("./kumho-product");
    // create·learn 둘 다 안 한다 — 이 함수는 **미리보기에서도** 불린다 (2026-08-27)
    const r = await resolveKumhoProduct(code);
    if (r.ok) {
      const [p] = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
        SELECT id, COALESCE(display_name, pattern) pattern, list_price_excl excl FROM product WHERE id = ${r.productId}`);
      if (p) return { ...p, via: r.via === "규격+패턴" ? "규격+모델" : "품번" };
    }
  }

  /**
   * ⭐ 콘티넨탈도 **자재 마스터**(continental_material)까지 본다 (사장님 요청 2026-08-29).
   *    2026 목록 737줄이 들어 있어, 콘티넨탈이 같은 타이어에 새 번호를 매겨도
   *    규격+모델명으로 이어 준다. ⚠️ 제네럴(GN)이 섞여 오므로 접두를 고정하지 않는다.
   */
  if (supplier === "콘티넨탈") {
    const { resolveContinentalProduct } = await import("./conti-product");
    // create·learn 둘 다 안 한다 — 미리보기에서도 불린다 (금호와 같은 이유)
    const r = await resolveContinentalProduct(code);
    if (r.ok) {
      const [p] = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
        SELECT id, COALESCE(display_name, pattern) pattern, list_price_excl excl FROM product WHERE id = ${r.productId}`);
      if (p) return { ...p, via: r.via === "규격+모델" ? "규격+모델" : "품번" };
    }
  }

  if (!description.trim()) return null;

  const { parseTireSpec } = await import("./tire-spec");
  const { modelTokens } = await import("./invoice-desc");
  const spec = parseTireSpec(description);
  if (!spec.parsed || spec.width === null || spec.rimInch === null) return null;

  const tokens = modelTokens(description);
  if (tokens.length === 0) return null;

  const brand = BRAND_CODE[supplier] ?? null;
  /** 모델코드가 하나라도 이름에 들어 있어야 한다 */
  const like = sql.join(
    tokens.map((t) => sql`(p.raw_name ILIKE ${"%" + t + "%"} OR p.pattern ILIKE ${"%" + t + "%"})`),
    sql` OR `,
  );

  const rows = await db.execute<{ id: number; pattern: string | null; excl: number | null }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) pattern, p.list_price_excl excl
    FROM product p
    WHERE p.item_type = 'tire'
      AND p.width = ${spec.width}
      AND p.rim_inch = ${String(spec.rimInch)}
      AND p.aspect_ratio IS NOT DISTINCT FROM ${spec.aspectRatio}
      ${brand ? sql`AND p.brand_code = ${brand}` : sql``}
      AND (${like})
    LIMIT 2
  `);
  // 둘 이상이면 고르지 않는다 — 잘못 붙이면 매입원가가 엉뚱한 상품에 들어간다
  if (rows.length !== 1) return null;
  return { ...rows[0], via: "규격+모델" };
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
    /** 타이어인가 · 수수료 같은 딴 줄인가 · 읽지 못했나 */
    kind: LineKind;
    productId: number | null;
    model: string | null;
    /** 품번으로 찾았나, 규격+모델로 찾았나 — 후자는 사람이 한 번 봐야 한다 */
    matchedBy: "품번" | "규격+모델" | null;
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
  /** 머리글은 알아봤는데 자료가 0줄인 경우의 거래처 이름 (2026-08-29) */
  let emptyOf: string | null = null;
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
      const ws = wb.Sheets[wb.SheetNames[0]];
      excelRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      // 자료가 0줄이면 머리글만 따로 봐 둔다 — 「빈 파일」과 「모르는 양식」을 가르려고
      if (excelRows.length === 0) {
        const head = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })[0] ?? [];
        emptyOf = (await import("./invoice-parse")).supplierOfHeader(head);
      }
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
    // 🔴 머리글은 맞는데 줄이 없는 파일을 「모르는 양식」이라 하면 안 된다 (사장님 제보 2026-08-29)
    if (emptyOf) {
      return { error: `${emptyOf} 인보이스 양식은 맞는데 **내용이 한 줄도 없습니다** — 조회 기간을 바꿔 다시 내려받아 주세요.` };
    }
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

    const { classifyLine } = await import("./invoice-desc");
    const { parseTireSpec } = await import("./tire-spec");

    const matches: InvoicePreview["matches"] = [];
    for (const it of parsed.items) {
      const kind = classifyLine(it.description, parseTireSpec(it.description).parsed);
      // 타이어가 아닌 줄(프랜차이즈 수수료 등)은 상품을 찾을 것도 없다
      const p = kind === "notTire" ? null : await matchProduct(it.cai, it.description, parsed.supplier);
      matches.push({
        cai: it.cai,
        kind,
        productId: p?.id ?? null,
        model: p?.pattern ?? null,
        matchedBy: p?.via ?? null,
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
      await savePriceRuleCore({ scope: "item", target: it.cai, purchaseRate: it.discountRate });
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
  /** ⭐ 담을 때 적어 둔 DOT (2026-08-08) — 전량 입고가 이 값을 쓴다 */
  dot: string | null;
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

  /**
   * 🔴 **품목이 하나도 없는 장부도 넣어야 한다.** (2026-08-02 사장님 신고로 발견)
   *
   * 위 목록은 `purchase_invoice_item` 에서 만든다. 그런데 직접 매입은
   * **빈 장부로 시작**한다 — 바코드를 찍어야 첫 품목이 생긴다.
   * 그래서 「시작」을 눌러도 장부가 목록에 안 나오고, 화면이 스캔 모드로
   * 바뀌지 않았다. 사장님이 바코드를 찍으면 커서가 아직 거래처 칸에 있어서
   * **바코드가 거래처 이름 뒤에 타이핑됐다** (`오픈링크8808563590301`).
   */
  const heads = await db.execute<{
    id: number;
    invoice_no: string;
    supplier: string;
    issued_at: string | null;
    status: string;
  }>(sql`
    SELECT i.id, i.invoice_no, i.supplier, i.issued_at, i.status
    FROM purchase_invoice i
    WHERE i.status <> '취소'
      AND NOT EXISTS (SELECT 1 FROM purchase_invoice_item x WHERE x.invoice_id = i.id)
    ORDER BY i.created_at DESC
  `);
  for (const h of heads) {
    const id = Number(h.id);
    if (map.has(id)) continue;
    map.set(id, {
      invoiceId: id,
      invoiceNo: h.invoice_no,
      supplier: h.supplier,
      issuedAt: h.issued_at,
      status: h.status,
      lines: [],
      remain: 0,
    });
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
  // 이 기기가 담던 장부였으면 담기 화면도 닫는다 (tm_draft — 기기별 직접 담기)
  const jar = await cookies();
  if (jar.get("tm_draft")?.value === String(invoiceId)) jar.delete("tm_draft");
  refresh("/receiving");
  return { ok: true };
}

/**
 * ⭐ 새로 만들기 전에 **이을 수 있는 기존 상품**을 보여준다 (품목 정리 ③, 2026-08-05).
 *
 * 중복의 뿌리가 여기다: 같은 타이어가 이미 있는데도 「상품 만들기」부터 눌러서
 * 갈라졌다. 인보이스 줄의 규격을 읽어 같은 브랜드·규격의 기존 상품을 후보로
 * 내밀고, 연결이 기본 동작이 되게 한다. 취급(사고판 적 있는 것)이 위로 온다.
 */
export interface LinkCandidate {
  id: number;
  name: string;
  marsItemNo: string | null;
  loadSpeed: string;
  listPrice: number | null;
  stockQty: number;
  /** 사고판·재고 이력이 있는 상품 — 이게 붙을 확률이 높다 */
  used: boolean;
}

export async function linkCandidates(itemId: number): Promise<LinkCandidate[]> {
  const [line] = await db.execute<{ description: string; supplier: string }>(sql`
    SELECT ii.description, i.supplier
    FROM purchase_invoice_item ii JOIN purchase_invoice i ON i.id = ii.invoice_id
    WHERE ii.id = ${itemId}
  `);
  if (!line) return [];
  const { parseTireSpec } = await import("./tire-spec");
  const spec = parseTireSpec(line.description);
  if (!spec.parsed || spec.width === null || spec.rimInch === null) return [];

  const BRAND_OF: Record<string, string> = { 미쉐린: "MI", 콘티넨탈: "CO", 금호: "KM" };
  const brandCode = BRAND_OF[line.supplier] ?? null;

  const rows = await db.execute<{
    id: number;
    name: string;
    mars_item_no: string | null;
    load_index: string | null;
    speed_rating: string | null;
    list_price: number | null;
    stock_qty: number;
    used: boolean;
  }>(sql`
    WITH used AS (
      SELECT DISTINCT product_id AS id FROM stock_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM quote_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM purchase_invoice_item WHERE product_id IS NOT NULL
      UNION SELECT DISTINCT product_id FROM supplier_item_code WHERE product_id IS NOT NULL
    )
    SELECT p.id, COALESCE(p.display_name, p.pattern, p.raw_name, '') AS name,
           p.mars_item_no, p.load_index, p.speed_rating, p.list_price,
           (SELECT COALESCE(SUM(s.qty),0) FROM stock_item s WHERE s.product_id = p.id AND s.status='재고')::int AS stock_qty,
           EXISTS (SELECT 1 FROM used u WHERE u.id = p.id) AS used
    FROM product p
    WHERE p.item_type = 'tire'
      AND p.width = ${spec.width}
      AND p.rim_inch = ${String(spec.rimInch)}
      AND p.aspect_ratio IS NOT DISTINCT FROM ${spec.aspectRatio}
      ${brandCode ? sql`AND p.brand_code = ${brandCode}` : sql``}
    ORDER BY EXISTS (SELECT 1 FROM used u WHERE u.id = p.id) DESC, p.id
    LIMIT 8
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    marsItemNo: r.mars_item_no,
    loadSpeed: `${r.load_index ?? ""}${r.speed_rating ?? ""}`,
    listPrice: r.list_price === null ? null : Number(r.list_price),
    stockQty: Number(r.stock_qty),
    used: r.used,
  }));
}

/**
 * 후보를 골라 **이 상품에 잇는다** — 그리고 거래처 사전에 남겨 다음부터는
 * 자동으로 붙게 한다 (품목 정리 ③의 핵심: 사람이 한 번 이으면 끝).
 */
export async function linkInvoiceItemTo(
  itemId: number,
  productId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [line] = await db.execute<{ cai: string; description: string; supplier: string; product_id: number | null }>(sql`
    SELECT ii.cai, ii.description, i.supplier, ii.product_id
    FROM purchase_invoice_item ii JOIN purchase_invoice i ON i.id = ii.invoice_id
    WHERE ii.id = ${itemId}
  `);
  if (!line) return { ok: false, error: "품목을 찾을 수 없습니다" };
  if (line.product_id) return { ok: false, error: "이미 상품이 연결돼 있습니다" };
  const [p] = await db.select({ id: product.id }).from(product).where(eq(product.id, productId)).limit(1);
  if (!p) return { ok: false, error: "상품을 찾을 수 없습니다" };

  await db.update(purchaseInvoiceItem).set({ productId }).where(eq(purchaseInvoiceItem.id, itemId));
  if (line.cai?.trim()) {
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by)
      VALUES (${line.supplier}, ${line.cai.trim()}, ${productId}, ${line.description}, '손으로')
      ON CONFLICT (supplier, code) DO NOTHING
    `);
  }
  refresh("/receiving", "/");
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
  const { parseTireAttrs } = await import("./tire-attrs");
  const { readModelName } = await import("./invoice-desc");

  const { classifyLine } = await import("./invoice-desc");
  const spec = parseTireSpec(line.description);
  if (!spec.parsed) {
    // 프랜차이즈 수수료 같은 줄은 상품이 될 수 없다 — 왜 안 되는지 분명히 말한다
    if (classifyLine(line.description, false) === "notTire") {
      return { ok: false, error: `타이어가 아닙니다 («${line.description}») — 등록하지 않고 넘어갑니다` };
    }
    return {
      ok: false,
      error: `규격을 읽지 못했습니다 («${line.description}»). 「새 상품 등록」에서 직접 넣어 주세요`,
    };
  }

  /**
   * ⭐ 모델명은 `invoice-desc` 가 만든다 (2026-08-03 사장님 지적으로 고침).
   *
   *    예전에는 규격만 대충 걷어내고 `parseTireName(desc, desc, spec)` 에 넘겼다.
   *    그 결과 이런 이름이 만들어졌다:
   *      `KH 245/60 R18 V04L HP72 8K;RK`  → «V04L HP72 8K»
   *      `275/35R19 96W FR PROCRX SIL`    → «PROCRX SIL»
   *      `195/70R15C 104/102R VANCAP`     → «C VANCAP»   ← 규격의 C 까지 새어 들어갔다
   *    이제 내부코드를 걷고 줄임말을 편다:
   *      → «Crugen HP72» · «ProContact RX ContiSilent» · «VanContact AP»
   */
  /**
   * ⭐ 금호는 **자재 마스터 한 벌**로 만든다 (사장님 요청 2026-08-27).
   *    이름·규격·겹수·흡음재·기표가가 전부 같은 규칙에서 나오고, 사전에도 코드가 등록된다.
   *    🔴 자재 마스터에 없는 코드로는 만들지 않는다 — 이름·규격·기표가가 전부 추측이 된다.
   *       사장님께 「최신 기표가 목록을 올려 주세요」라고 알린다.
   */
  if (b.code === "KM" && line.cai?.trim()) {
    const { resolveKumhoProduct } = await import("./kumho-product");
    const r = await resolveKumhoProduct(line.cai.trim(), { create: true });
    if (!r.ok) return { ok: false, error: r.message };
    await db.update(purchaseInvoiceItem).set({ productId: r.productId }).where(eq(purchaseInvoiceItem.id, itemId));
    refresh("/receiving", "/");
    return { ok: true, productId: r.productId };
  }

  /**
   * ⭐ 콘티넨탈·제네럴도 **자재 마스터 한 벌**로 만든다 (2026-08-29).
   *    이름·규격·계절·기표가가 전부 conti-name 규칙에서 나온다 —
   *    아래 일반 경로로 만들면 목록 올리기와 **다른 이름**이 나온다 (금호 ddedbce 의 교훈).
   *    🔴 자재 마스터에 없는 번호로는 만들지 않는다.
   */
  if ((b.code === "CO" || b.code === "GN") && line.cai?.trim()) {
    const { resolveContinentalProduct } = await import("./conti-product");
    const r = await resolveContinentalProduct(line.cai.trim(), { create: true });
    if (r.ok) {
      await db.update(purchaseInvoiceItem).set({ productId: r.productId }).where(eq(purchaseInvoiceItem.id, itemId));
      refresh("/receiving", "/");
      return { ok: true, productId: r.productId };
    }
    // 자재 마스터에 없으면 아래 일반 경로로 — 콘티넨탈 인보이스 설명은 사람이 읽는 이름이라 쓸 만하다
  }

  const model = readModelName(line.description);
  const attrs = parseTireAttrs(model, line.description);

  /**
   * ⭐ 표시 이름도 표준 규칙으로 짓는다 (사장님 요청 2026-08-08 —
   *    "이러한 규칙이 매입받을때 인보이스를 엑셀로 올릴때 반영되게").
   *    일괄 정리(backfill-display-names)와 같은 조립: 모델명 + 겹수 + OE 마킹.
   */
  const { parseTireName, cleanTireName } = await import("./tire-name");
  const displayName =
    cleanTireName(
      parseTireName(line.description, model, {
        width: spec.width,
        aspectRatio: spec.aspectRatio,
        rimInch: spec.rimInch !== null ? String(spec.rimInch) : null,
        brandCode: b.code,
      }),
    ) || null;

  /**
   * 🔴 기표가는 **인보이스에 진짜 기표가가 있을 때만** 넣는다 (사장님 지적 2026-08-05).
   *    전에는 "0 보다 낫다"며 매입가(공급가액)로 대신 채웠는데, 금호 인보이스에는
   *    기표가 열이 없어서 금호 상품 176개의 기표가가 매입가로 잘못 잡혔다 —
   *    기표가는 판매가 계산의 출발점이라 마진이 통째로 틀어진다.
   *    모르면 비워 둔다. 금호는 자재검색 목록을 올리면 공장도가가 채워진다.
   */
  const excl = line.unit_list_price && line.unit_list_price > 0 ? line.unit_list_price : null;
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
        pattern: model,
        displayName,
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

/* ============================================================
 * 직접 매입 — 인보이스가 없는 경우 ⭐ (사장님 요청 2026-08-01)
 *
 * 본사 발주가 아니라 거래처에서 여러 브랜드를 사 오는 경우가 있다.
 * 엑셀이 없으므로 **바코드를 찍어 목록을 만들어 간다.**
 *
 * ⭐ 구조는 인보이스와 똑같이 쓴다 (`purchase_invoice`, supplier = 거래처명).
 *    그래야 매입 내역·원가 추적이 한 곳에서 이어진다.
 *    따로 만들면 나중에 정산할 때 두 군데를 봐야 한다.
 * ========================================================== */

/**
 * 이미 쓴 적 있는 거래처 목록.
 *
 * ⚠️ 같은 거래처가 「쌍성타이어」·「쌍성」처럼 여러 이름으로 생기면
 *    매입 내역이 갈라져 나중에 합칠 수 없다. 그래서 **치는 동안 보여준다.**
 */
export async function supplierList(q = ""): Promise<{ name: string; count: number; lastAt: string | null }[]> {
  const term = q.replace(/\s/g, "").toLowerCase();
  /**
   * ⭐ 거래처 표(`supplier`)와 인보이스에 적힌 이름을 **둘 다** 본다 (2026-08-03).
   *    · 표에만 있는 곳 — 설정에서 미리 등록만 해 둔 새 거래처
   *    · 인보이스에만 있는 곳 — 거래처 표를 만들기 전에 쓰던 이름
   *    숨긴 거래처(`is_active = false`)는 제안하지 않는다.
   */
  const rows = await db.execute<{ supplier: string; n: number; last_at: string | null }>(sql`
    WITH inv AS (
      SELECT replace(lower(supplier),' ','') k, max(supplier) supplier,
             count(*)::int n, max(issued_at) last_at, max(created_at) at
      FROM purchase_invoice WHERE btrim(supplier) <> '' GROUP BY 1
    ), reg AS (
      SELECT name_key k, name supplier, 0 n, NULL::text last_at, created_at at
      FROM supplier WHERE is_active
    )
    SELECT COALESCE(r.supplier, i.supplier) supplier,
           COALESCE(i.n, 0) n,
           i.last_at,
           COALESCE(i.at, r.at) at
    FROM inv i
    FULL OUTER JOIN reg r ON r.k = i.k
    -- 표에 있으면 그대로, 인보이스에만 있으면 「숨김」으로 꺼 두지 않은 것만
    WHERE r.k IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM supplier s WHERE s.name_key = i.k AND NOT s.is_active)
    ORDER BY at DESC NULLS LAST
    LIMIT 200
  `);
  const all = rows.map((r) => ({ name: r.supplier, count: r.n, lastAt: r.last_at }));
  if (!term) return all.slice(0, 8);
  // 공백을 무시하고 부분 일치 — "쌍성" 으로 "쌍성 타이어" 를 찾는다
  return all.filter((s) => s.name.replace(/\s/g, "").toLowerCase().includes(term)).slice(0, 8);
}

/** 직접 매입 시작 — 빈 장부를 하나 연다 */
export async function startManualPurchase(
  supplier: string,
  memo?: string,
): Promise<{ ok: true; invoiceId: number } | { ok: false; error: string }> {
  const name = supplier.trim();
  if (!name) return { ok: false, error: "거래처를 입력해 주세요" };
  /**
   * 바코드가 거래처 칸에 딸려 들어온 것을 막는다.
   * 실제로 `오픈링크8808563590301` 같은 거래처가 만들어졌다 (2026-08-02).
   */
  if (/\d{8,}$/.test(name)) {
    return { ok: false, error: "거래처 이름에 바코드가 섞였습니다. 숫자를 지우고 다시 눌러 주세요" };
  }

  /**
   * ⭐ 이미 열려 있는 같은 거래처 장부가 있으면 **그것을 다시 쓴다.**
   * 안 그러면 「시작」을 누를 때마다 빈 장부가 쌓인다 — 실제로 5건이 쌓였다.
   */
  const [dup] = await db.execute<{ id: number }>(sql`
    SELECT i.id FROM purchase_invoice i
    WHERE i.invoice_no LIKE '직접-%' AND i.status = '입고대기'
      AND replace(lower(i.supplier), ' ', '') = ${name.replace(/\s/g, "").toLowerCase()}
      AND NOT EXISTS (
        SELECT 1 FROM purchase_invoice_item x WHERE x.invoice_id = i.id AND x.received_qty > 0
      )
    ORDER BY i.created_at DESC LIMIT 1
  `);
  if (dup) {
    await claimDraft(Number(dup.id));
    refresh("/receiving");
    return { ok: true, invoiceId: Number(dup.id) };
  }

  // 🔴 Vercel 은 UTC — 밤 9시 전에는 날짜가 하루 어긋난다. KST 로 못박는다 (2026-08-19)
  const kstDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const day = kstDate.replace(/-/g, "");

  /**
   * 🔴 개수+1 이 아니라 **최대 번호+1** (2026-08-19 실서비스 오류 Digest 3893553580).
   *    오늘 만든 장부를 하나 지우면 개수가 줄어, 다음 번호가 살아 있는 번호와
   *    겹쳐 duplicate key 로 죽었다 (직접-20260819-02 중복).
   */
  const [seq] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(split_part(invoice_no, '-', 3)::int), 0) + 1 AS n
    FROM purchase_invoice
    WHERE invoice_no LIKE ${"직접-" + day + "-%"} AND split_part(invoice_no, '-', 3) ~ '^\\d+$'
  `);

  let inv: { id: number };
  try {
    [inv] = await db
      .insert(purchaseInvoice)
      .values([
        {
          supplier: name,
          invoiceNo: `직접-${day}-${String(seq?.n ?? 1).padStart(2, "0")}`,
          issuedAt: kstDate,
          status: "입고대기",
          fileName: memo?.trim() || null,
        },
      ])
      .returning({ id: purchaseInvoice.id });
  } catch (e) {
    // 동시에 두 기기가 눌렀을 때 등 — 죽지 말고 사람 말로 알린다
    if (/duplicate key|23505/.test(String(e))) {
      return { ok: false, error: "장부 번호가 겹쳤습니다 — 한 번만 다시 눌러 주세요" };
    }
    throw e;
  }

  await claimDraft(inv.id);
  refresh("/receiving");
  return { ok: true, invoiceId: inv.id };
}

/**
 * ⭐ 직접 담기 장부는 **기기(브라우저)마다 따로** 다 (사장님 지적 2026-08-06).
 *
 *   "다른 유저가 직접담기를 진행하는 도중에는 다른 유저도 똑같은 화면을 봐야
 *    한다는 것이 문제점. 유저마다 … 따로따로 할 수 있되 입고 예정에는 동시에
 *    반영되어 같이 공유할 수 있도록."
 *
 * 전에는 「가장 최근에 열린 직접 장부」를 모두에게 보여줬다 — 한 사람이 담는 동안
 * 다른 사람도 그 장부에 갇혔다. 이제 어느 장부를 담는 중인지는 **쿠키**(tm_draft)로
 * 기기마다 기억한다. 장부 자체는 DB 하나이므로 입고 예정 목록에는 모두에게 보인다.
 */
async function claimDraft(invoiceId: number) {
  (await cookies()).set("tm_draft", String(invoiceId), { path: "/", maxAge: 60 * 60 * 24 * 30 });
}

/** 다른 기기에서 담던 직접 장부를 이 기기로 가져와 이어 담는다 */
export async function resumeManualPurchase(
  invoiceId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [inv] = await db.execute<{ id: number; invoice_no: string; status: string }>(
    sql`SELECT id, invoice_no, status FROM purchase_invoice WHERE id = ${invoiceId}`,
  );
  if (!inv) return { ok: false, error: "장부를 찾을 수 없습니다" };
  if (!String(inv.invoice_no).startsWith("직접-")) return { ok: false, error: "직접 매입 장부가 아닙니다" };
  await claimDraft(Number(inv.id));
  refresh("/receiving");
  return { ok: true };
}

/**
 * ⭐ 품목을 **찾아서** 매입 장부에 담는다 (사장님 요청 2026-08-03)
 *
 *   "바코드 이외에도 품목 검색을 통해서도 매입 입고가 가능하게 해줬으면 좋겠어.
 *    한 품목이 아니라 여러 품목도 가능했으면 좋겠음."
 *
 * 🔴 2026-08-04 — 이제 **이것이 유일한 경로**다. 바코드로 담던 길은 걷어냈다
 *    (사장님: "써보니 생각보다 불편하다"). 라벨이 떨어졌거나 거래처가 아예 안
 *    붙여 보내는 경우가 흔해 검색이 어차피 주 경로였다.
 *
 * ⚠️ 인보이스 장부에도 담을 수 있다. 인보이스보다 물건이 더 온 경우다.
 *    같은 상품이 이미 있으면 **수량을 더한다** — 새 줄을 만들면 같은 상품이
 *    두 줄이 되어 입고할 때 헷갈린다.
 */
export async function addProductToPurchase(input: {
  invoiceId: number;
  productId: number;
  qty: number;
  unitCost?: number | null;
}): Promise<{ ok: true; model: string; qty: number } | { ok: false; error: string }> {
  // 🔴 매입가 쓰기는 사장님만 — 담기는 누구나, 값만 무시한다 (D-05, 2026-08-08)
  if (input.unitCost !== undefined && !(await isOwner())) input = { ...input, unitCost: undefined };
  const { invoiceId, productId } = input;
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "수량은 1 이상이어야 합니다" };

  const [inv] = await db
    .select({ id: purchaseInvoice.id, status: purchaseInvoice.status })
    .from(purchaseInvoice)
    .where(eq(purchaseInvoice.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "매입 장부를 찾지 못했습니다" };
  if (inv.status === "입고완료") return { ok: false, error: "이미 입고를 마친 장부입니다" };

  const [p] = await db.execute<{
    id: number;
    mars_item_no: string | null;
    raw_name: string;
    pattern: string | null;
    display_name: string | null;
    brand_code: string | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
  }>(sql`
    SELECT id, mars_item_no, raw_name, pattern, display_name, brand_code, width, aspect_ratio, rim_inch
    FROM product WHERE id = ${productId}
  `);
  if (!p) return { ok: false, error: "상품을 찾지 못했습니다" };

  const { parseTireName } = await import("./tire-name");
  const n = parseTireName(p.raw_name, p.pattern, {
    width: p.width,
    aspectRatio: p.aspect_ratio,
    rimInch: p.rim_inch,
    brandCode: p.brand_code,
  });
  const model = p.display_name?.trim() || n.model;

  /**
   * 같은 상품 합치기는 **DOT 를 아직 안 적은 줄에만** 한다 (2026-08-08).
   * DOT 를 적어 둔 줄은 그 DOT 묶음이다 — 거기에 합치면 다른 DOT 물건이 섞인다.
   * 그래서 「담기 → DOT 적기 → 같은 상품 또 담기」가 자연스럽게 새 줄이 된다.
   */
  const [exist] = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(
      and(
        eq(purchaseInvoiceItem.invoiceId, invoiceId),
        eq(purchaseInvoiceItem.productId, productId),
        sql`${purchaseInvoiceItem.dot} IS NULL`,
      ),
    )
    .limit(1);

  if (exist) {
    const next = exist.qty + qty;
    await db
      .update(purchaseInvoiceItem)
      .set({
        qty: next,
        ...(input.unitCost !== undefined && input.unitCost !== null
          ? { unitCost: input.unitCost, supplyAmount: input.unitCost * next }
          : {}),
      })
      .where(eq(purchaseInvoiceItem.id, exist.id));
    await recalcInvoiceTotals(invoiceId);
    refresh("/receiving");
    return { ok: true, model, qty: next };
  }

  await db.insert(purchaseInvoiceItem).values([
    {
      invoiceId,
      // cai 는 비울 수 없다. 품번이 없는 상품(거의 없다)은 내부 번호로 채운다
      cai: p.mars_item_no ?? `ID-${p.id}`,
      productId: Number(p.id),
      description: [model, n.spec].filter(Boolean).join(" ") || p.raw_name,
      qty,
      unitCost: input.unitCost ?? null,
      supplyAmount: input.unitCost ? input.unitCost * qty : null,
    },
  ]);
  await recalcInvoiceTotals(invoiceId);
  refresh("/receiving");
  return { ok: true, model, qty };
}

/** 직접 매입 품목의 수량·매입가·DOT 를 고친다 */
export async function updatePurchaseItem(input: {
  itemId: number;
  qty?: number;
  unitCost?: number | null;
  /** ⭐ 담을 때 적어 두는 DOT (2026-08-08) — null/빈 값이면 지운다 */
  dot?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  // 🔴 매입가 쓰기는 사장님만 — 수량 수정은 누구나 (D-05, 2026-08-08)
  if (input.unitCost !== undefined && !(await isOwner())) input = { ...input, unitCost: undefined };
  const set: Record<string, unknown> = {};
  if (input.qty !== undefined) {
    if (!Number.isInteger(input.qty) || input.qty < 1) return { ok: false, error: "수량을 확인해 주세요" };
    set.qty = input.qty;
  }
  if (input.dot !== undefined) {
    const d = input.dot?.trim() || null;
    if (d && !isPlausibleDot(d)) {
      return { ok: false, error: `DOT '${d}' 를 확인해 주세요 (주차 01~53, 최근 15년)` };
    }
    set.dot = d;
  }
  if (input.unitCost !== undefined) {
    set.unitCost = input.unitCost;
    // 합계도 같이 맞춰 둔다 — 나중에 정산에서 쓴다
    const [it] = await db
      .select()
      .from(purchaseInvoiceItem)
      .where(eq(purchaseInvoiceItem.id, input.itemId))
      .limit(1);
    if (it) set.supplyAmount = (input.unitCost ?? 0) * (input.qty ?? it.qty);
  }
  if (Object.keys(set).length === 0) return { ok: true };

  await db.update(purchaseInvoiceItem).set(set).where(eq(purchaseInvoiceItem.id, input.itemId));

  // 장부 합계 갱신
  const [it] = await db
    .select({ invoiceId: purchaseInvoiceItem.invoiceId })
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.id, input.itemId))
    .limit(1);
  if (it) await recalcInvoiceTotals(it.invoiceId);

  refresh("/receiving");
  return { ok: true };
}

async function recalcInvoiceTotals(invoiceId: number) {
  await db.execute(sql`
    UPDATE purchase_invoice SET
      total_qty = s.qty, subtotal = s.amt,
      vat = round(s.amt * 0.1)::int, total = round(s.amt * 1.1)::int, updated_at = now()
    FROM (
      SELECT COALESCE(SUM(qty),0)::int qty, COALESCE(SUM(COALESCE(supply_amount,0)),0)::int amt
      FROM purchase_invoice_item WHERE invoice_id = ${invoiceId}
    ) s
    WHERE id = ${invoiceId}
  `);
}

/**
 * ⭐ 남은 수량 전부 입고 (사장님 요청 2026-08-01)
 *   한 번에 재고로 넘긴다. 줄마다 세어 넣는 것은 `receiveLine` 이 한다.
 *   ⚠️ DOT 는 비워 둔다. 나중에 재고 화면에서 채울 수 있다 (D-02).
 */
export async function receiveAll(
  invoiceId: number,
  userId?: number,
): Promise<
  | { ok: true; created: number; failed: string[]; skipped: number }
  | { ok: false; error: string }
> {
  const lines = (await pendingLines()).filter((l) => l.invoiceId === invoiceId);
  if (lines.length === 0) return { ok: false, error: "입고할 것이 없습니다" };

  const { classifyLine } = await import("./invoice-desc");
  const { parseTireSpec } = await import("./tire-spec");

  let created = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const l of lines) {
    const remain = l.qty - l.receivedQty;
    if (remain <= 0) continue;

    /**
     * ⭐ 타이어가 아닌 줄(프랜차이즈 수수료 등)은 재고가 될 수 없다 (사장님 확인 2026-08-03).
     *
     * ⚠️ 그냥 건너뛰면 안 된다. 인보이스 상태는 「모든 품목이 다 들어왔는가」로 정해지는데,
     *    수수료 줄이 영원히 안 들어온 상태로 남아 **입고완료가 되지 않는다.**
     *    재고는 만들지 않고 **받은 것으로만 표시**한다 — 실제로 청구된 값이니 맞는 표현이다.
     */
    if (!l.productId && classifyLine(l.description, parseTireSpec(l.description).parsed) === "notTire") {
      await db
        .update(purchaseInvoiceItem)
        .set({ receivedQty: l.qty, receivedAt: new Date() })
        .where(eq(purchaseInvoiceItem.id, l.itemId));
      skipped++;
      continue;
    }

    // ⭐ 담을 때 적어 둔 DOT 가 있으면 그대로 재고에 박는다 (2026-08-08)
    const r = await receiveLine({ itemId: l.itemId, qty: remain, dot: l.dot ?? null, userId });
    if (r.ok) created += r.created;
    else failed.push(`${l.model ?? l.cai}: ${r.error}`);
  }

  // 수수료 줄만 있었을 수도 있다 — 그때도 인보이스 상태를 다시 계산해 준다
  if (skipped > 0) {
    await db.execute(sql`
      UPDATE purchase_invoice SET
        status = CASE WHEN EXISTS (SELECT 1 FROM purchase_invoice_item x
                                   WHERE x.invoice_id = ${invoiceId} AND x.received_qty < x.qty)
                      THEN '부분입고' ELSE '입고완료' END,
        updated_at = now()
      WHERE id = ${invoiceId}
    `);
  }
  refresh("/receiving", "/");
  return { ok: true, created, failed, skipped };
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
    dot: string | null;
  }>(sql`
    SELECT ii.id item_id, i.id invoice_id, i.invoice_no, i.supplier, i.issued_at,
           ii.cai, ii.product_id, ii.description, p.pattern, p.display_name,
           p.width, p.aspect_ratio, p.rim_inch,
           ii.qty, ii.received_qty, ii.unit_cost, ii.dot
    FROM purchase_invoice_item ii
    JOIN purchase_invoice i ON i.id = ii.invoice_id
    LEFT JOIN product p ON p.id = ii.product_id
    WHERE i.status <> '취소' AND ii.received_qty < ii.qty
    ORDER BY i.issued_at DESC, ii.id
  `);

  /**
   * ⚠️ `bigint` 컬럼은 드라이버가 **문자열**로 준다.
   *    그대로 두면 `invoiceId === 128` 같은 비교가 조용히 실패한다 —
   *    화면에서 인보이스를 못 찾거나 엉뚱한 것에 붙는다 (2026-08-01 발견).
   *    숫자로 맞춰서 내보낸다.
   */
  return rows.map((r) => ({
    itemId: Number(r.item_id),
    invoiceId: Number(r.invoice_id),
    invoiceNo: r.invoice_no,
    supplier: r.supplier,
    issuedAt: r.issued_at,
    cai: r.cai,
    productId: r.product_id === null ? null : Number(r.product_id),
    description: r.description,
    model: r.display_name ?? r.pattern,
    spec:
      r.width && r.aspect_ratio && r.rim_inch
        ? `${r.width}/${r.aspect_ratio}R${Number(r.rim_inch)}`
        : null,
    qty: Number(r.qty),
    receivedQty: Number(r.received_qty),
    unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    dot: r.dot,
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
  /**
   * 🔴 이 흐름은 타이어 전용(1본 1행)이다 (2026-08-18) — 부품 줄을 태우면 5개가
   *    5행으로 쪼개진다. 부품 매입은 붙여넣기 카드의 「입고」 버튼이 맡는다.
   */
  const [prodKind] = await db.execute<{ is_serialized: boolean }>(sql`
    SELECT is_serialized FROM product WHERE id = ${line.productId}
  `);
  if (prodKind && prodKind.is_serialized === false) {
    return { ok: false, error: "부품 줄은 이 흐름으로 입고할 수 없습니다 — 붙여넣기 카드의 「입고」 버튼을 써 주세요" };
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
    /** ⭐ 어느 매입 줄에서 왔는지 — 매입 내역의 수정·지우기가 이 끈을 쓴다 (2026-08-09) */
    purchaseItemId: line.id,
    /**
     * `serial`(개별 식별자)은 라벨 바코드에서만 나오던 값이다.
     * 바코드를 걷어내면서(2026-08-04) 채울 길이 없어졌다 — 컬럼은 남겨 둔다.
     * 보관 서비스에서 한 본을 특정하는 방법은 따로 정해야 한다 (D-03).
     */
    serial: null,
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
    // ⭐ 입고 확정을 누른 이 순간이 입고 시각이다 (사장님 지시 2026-08-08) — 매입 내역의 날짜 기준
    .set({ receivedQty: line.receivedQty + input.qty, receivedAt: new Date() })
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

/** 금액 없는 매입 장부 수 — 매입 입고 화면 배지용 (사장님 목표 2026-08-25: "0원 매입 없애기") */
export async function zeroTotalInvoiceCount(): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_invoice
    WHERE status <> '취소' AND COALESCE(total, 0) = 0
  `);
  return Number(r?.n ?? 0);
}
