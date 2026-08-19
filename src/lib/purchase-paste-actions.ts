"use server";

/**
 * ⭐ 붙여넣기 매입 — 상품 잇기·저장·입고 (사장님 요청 2026-08-15)
 *
 * 사장님 결정: **물건이 도착했을 때 붙여넣는다 → 바로 재고로**, 매입가도 자동 갱신.
 *
 * 🔴 기존 매입 입고(`invoice.ts` receiveLine)는 **타이어 전용**이다 — 1본 1행으로
 *    stock_item 을 수량만큼 만든다. 부품은 한 행에 수량이라 그대로 쓰면 오일필터
 *    5개가 5줄이 된다. 그래서 여기서 유형을 보고 갈라 넣는다.
 *
 * 🔴 못 이은 코드는 버리지 않는다 — 사장님이 한 번 골라 주면
 *    `supplier_item_code` 에 적어 두고 다음부터 그 거래처의 같은 코드는 저절로 이어진다.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { product, purchaseInvoice, purchaseInvoiceItem, stockItem, stockMovement, supplierItemCode } from "@/db/schema";
import { getSession, isOwner } from "./auth";
import { parsePastedPurchase, type PastedLine } from "./purchase-paste";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface MatchedLine extends PastedLine {
  productId: number | null;
  productName: string | null;
  /** 어떻게 이었나 — 화면에서 근거를 보여 준다 */
  matchedBy: "품번" | "거래처 사전" | "제조사 품번" | "MARS 품번" | null;
  /** 지금 재고 */
  stockQty: number;
  /** 기존 매입가 — 붙여넣은 단가와 다르면 화면에 알린다 */
  oldCost: number | null;
  isPart: boolean;
}

export interface PastePreview {
  format: string;
  lines: MatchedLine[];
  skipped: string[];
  matched: number;
  totalQty: number;
  totalAmount: number;
}

/* ============================================================
 * 미리보기 — 읽고, 상품과 잇고, 화면에 보여 줄 것을 만든다
 * ========================================================== */
export async function previewPastedPurchase(text: string, supplier: string): Promise<PastePreview> {
  const parsed = parsePastedPurchase(text);
  const sup = supplier.trim();
  const lines: MatchedLine[] = [];

  for (const l of parsed.lines) {
    const code = l.code.trim();
    /**
     * 이을 후보를 순서대로 본다. 나이스번호는 우리 품번과 같은 값이라 대개 ①에서 끝난다.
     * `MRA-B25_SP1691` 처럼 접미가 붙은 코드는 접미(SP1691)로도 찾아본다 —
     * 옛 상신 코드로 들어온 재고가 거기 있다.
     */
    const suffix = code.includes("_") ? code.slice(code.indexOf("_") + 1) : null;
    const keys = [code, ...(suffix ? [suffix] : [])];
    /**
     * 🔴 `= ANY(${배열})` 은 쓰지 않는다 (2026-08-15 실서비스 500) —
     *    drizzle 이 JS 배열을 Postgres 배열 리터럴로 못 묶어
     *    「malformed array literal」로 죽는다. IN 목록으로 편다 (값은 그대로 파라미터).
     */
    const keyList = sql.join(
      keys.map((k) => sql`${k.toUpperCase()}`),
      sql`, `,
    );

    const [hit] = await db.execute<{
      id: number; name: string; item_type: string; purchase_price: number | null;
      qty: number; how: string;
    }>(sql`
      WITH cand AS (
        SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.raw_name) name, p.item_type,
               p.purchase_price, '품번' how, 1 pri
        FROM product p
        WHERE p.is_active AND upper(p.part_no) IN (${keyList})
        UNION ALL
        SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.raw_name), p.item_type,
               p.purchase_price, '거래처 사전', 2
        FROM supplier_item_code sc JOIN product p ON p.id = sc.product_id
        WHERE sc.supplier = ${sup} AND upper(sc.code) = ${code.toUpperCase()}
        UNION ALL
        SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.raw_name), p.item_type,
               p.purchase_price, 'MARS 품번', 3
        FROM product p
        WHERE p.is_active AND upper(p.mars_item_no) = ${code.toUpperCase()}
        ${
          l.oemNos.length
            ? sql`UNION ALL
        SELECT p.id, COALESCE(NULLIF(p.display_name,''), p.raw_name), p.item_type,
               p.purchase_price, '제조사 품번', 4
        FROM product p
        WHERE p.is_active AND p.item_type='part'
          AND ${sql.join(
            l.oemNos.slice(0, 4).map((o) => sql`p.fitment ILIKE ${"%" + o + "%"}`),
            sql` OR `,
          )}`
            : sql``
        }
      )
      SELECT c.id, c.name, c.item_type, c.purchase_price, c.how,
             COALESCE((SELECT SUM(s.qty)::int FROM stock_item s
                       WHERE s.product_id = c.id AND s.status='재고'), 0) qty
      FROM cand c ORDER BY c.pri LIMIT 1
    `);

    lines.push({
      ...l,
      productId: hit ? Number(hit.id) : null,
      productName: hit?.name ?? null,
      matchedBy: (hit?.how as MatchedLine["matchedBy"]) ?? null,
      stockQty: Number(hit?.qty ?? 0),
      oldCost: hit?.purchase_price === null || hit?.purchase_price === undefined ? null : Number(hit.purchase_price),
      isPart: hit?.item_type === "part",
    });
  }

  return {
    format: parsed.format,
    lines,
    skipped: parsed.skipped,
    matched: lines.filter((l) => l.productId).length,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalAmount: lines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0),
  };
}

/* ============================================================
 * 못 이은 코드를 상품에 잇는다 — 거래처 사전에 남겨 다음부터 자동
 * ========================================================== */
export async function linkPastedCode(input: {
  supplier: string;
  code: string;
  productId: number;
  supplierName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  const supplier = input.supplier.trim();
  const code = input.code.trim();
  if (!supplier || !code) return { ok: false, error: "거래처와 품번이 필요합니다" };
  await db.execute(sql`
    INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by)
    VALUES (${supplier}, ${code}, ${input.productId}, ${input.supplierName ?? null}, '붙여넣기')
    ON CONFLICT (supplier, code) DO UPDATE SET product_id = ${input.productId}, updated_at = now()
  `);
  return { ok: true };
}

/* ============================================================
 * 저장 — 매입 장부를 만들고 바로 입고까지
 * ========================================================== */
export interface SaveLine {
  productId: number;
  code: string;
  name: string;
  qty: number;
  unitCost: number | null;
}

export async function savePastedPurchase(input: {
  supplier: string;
  lines: SaveLine[];
  memo?: string | null;
  /** 붙여넣은 원문 — 나중에 파서를 고쳐 다시 읽을 수 있게 남긴다 */
  rawText?: string | null;
}): Promise<{ ok: true; invoiceId: number; saved: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };

  const supplier = input.supplier.trim();
  if (!supplier) return { ok: false, error: "거래처를 입력해 주세요" };
  const lines = input.lines.filter((l) => l.productId && l.qty > 0);
  if (lines.length === 0) return { ok: false, error: "담을 품목이 없습니다" };

  const now = new Date();
  // 🔴 Vercel 은 UTC — 그대로 쓰면 저녁 6시 붙여넣기가 「09시」로 찍히고, 밤 9시 전엔 날짜도 하루 어긋난다 (2026-08-19 실측)
  const kst = now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // '2026-08-19 18:03:05'
  const today = kst.slice(0, 10);
  /** 장부 번호 — 같은 날 여러 번 붙여넣을 수 있으니 시각까지 넣는다 */
  const invoiceNo = `붙여넣기-${today.replace(/-/g, "")}-${kst.slice(11).replace(/:/g, "")}`;

  const subtotal = lines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0);
  let saved = 0;

  const [inv] = await db
    .insert(purchaseInvoice)
    .values({
      supplier,
      invoiceNo,
      issuedAt: today,
      totalQty: lines.reduce((s, l) => s + l.qty, 0),
      subtotal,
      vat: Math.round(subtotal * 0.1),
      total: subtotal + Math.round(subtotal * 0.1),
      status: "입고대기", // ⭐ 사장님 결정 변경(2026-08-18): 먼저 입고 예정으로, 도착 후 「입고」 버튼
      fileName: input.memo?.trim() || null,
      rawText: input.rawText?.slice(0, 20000) ?? null,
      createdBy: session.uid ?? null,
    })
    .returning({ id: purchaseInvoice.id });

  for (const l of lines) {
    await db.insert(purchaseInvoiceItem).values({
      invoiceId: inv.id,
      cai: l.code,
      productId: l.productId,
      description: l.name.slice(0, 200),
      qty: l.qty,
      /** ⭐ 아직 안 들어왔다 — 도착하면 receivePastedInvoice 가 입고한다 (2026-08-18) */
      receivedQty: 0,
      supplyAmount: l.unitCost ? l.unitCost * l.qty : null,
      unitCost: l.unitCost,
    });
    saved += l.qty;

    /** 거래처 사전에 남긴다 — 다음에 같은 코드가 오면 바로 이어진다 */
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by)
      VALUES (${supplier}, ${l.code}, ${l.productId}, ${l.name.slice(0, 200)}, '붙여넣기')
      ON CONFLICT (supplier, code) DO NOTHING
    `);
  }

  refresh("/receiving", "/stock", "/", "/settings");
  return { ok: true, invoiceId: inv.id, saved };
}

/* ============================================================
 * ⭐ 입고 — 물건이 실제로 도착했을 때 버튼으로 (사장님 결정 변경 2026-08-18)
 *
 *   "붙여담기로 매입의 경우도 바로 입고되지 않고 입고 예정으로 먼저 옮겨 놓은
 *    다음에 실제로 입고후 입고하는 버튼을 눌러서 재고에 반영되도록"
 *
 * 저장(savePastedPurchase)이 하던 재고 반영·매입가 갱신이 전부 여기로 왔다.
 * 타이어는 1본 1행, 부품은 한 행에 수량 — 기존 규칙 그대로.
 * ========================================================== */
export async function receivePastedInvoice(
  invoiceId: number,
): Promise<{ ok: true; received: number; priceUpdated: number } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };
  const owner = await isOwner();

  const [inv] = await db
    .select({ id: purchaseInvoice.id, supplier: purchaseInvoice.supplier, invoiceNo: purchaseInvoice.invoiceNo })
    .from(purchaseInvoice)
    .where(eq(purchaseInvoice.id, invoiceId))
    .limit(1);
  if (!inv) return { ok: false, error: "매입 장부를 찾을 수 없습니다" };

  const lines = await db
    .select()
    .from(purchaseInvoiceItem)
    .where(eq(purchaseInvoiceItem.invoiceId, invoiceId));
  const todo = lines.filter((l) => l.receivedQty < l.qty && l.productId);
  if (todo.length === 0) return { ok: false, error: "입고할 것이 없습니다 (이미 다 들어왔습니다)" };

  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const [seqRow] = await db.execute<{ n: number }>(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(stock_no, '^S\\d{2}-', ''), '')::bigint), 0)::int + 1 AS n
    FROM stock_item WHERE stock_no LIKE ${"S" + yy + "-%"}
  `);
  let seq = seqRow?.n ?? 1;

  let received = 0;
  let priceUpdated = 0;
  for (const l of todo) {
    const take = l.qty - l.receivedQty;
    const [p] = await db
      .select({ id: product.id, isSerialized: product.isSerialized, purchasePrice: product.purchasePrice })
      .from(product)
      .where(eq(product.id, l.productId!))
      .limit(1);
    if (!p) continue;

    if (p.isSerialized) {
      /* 타이어 — 1본 1행 */
      const values = Array.from({ length: take }, (_, i) => ({
        stockNo: `S${yy}-${String(seq + i).padStart(6, "0")}`,
        productId: l.productId!,
        qty: 1,
        status: "재고",
        dot: null,
        purchasePrice: l.unitCost,
        purchaseItemId: l.id,
        verifiedAt: now,
        createdBy: session.uid ?? null,
      }));
      seq += take;
      const ins = await db.insert(stockItem).values(values).returning({ id: stockItem.id });
      await db.insert(stockMovement).values(
        ins.map((r) => ({
          stockItemId: r.id,
          type: "입고",
          reason: "매입입고(붙여넣기)",
          qtyDelta: 1,
          memo: `${inv.supplier} ${l.cai}`,
          createdBy: session.uid ?? null,
        })),
      );
    } else {
      /* 부품 — 한 행에 수량. 이미 줄이 있으면 더하고, 없으면 새로 만든다 */
      const [exist] = await db
        .select({ id: stockItem.id, qty: stockItem.qty })
        .from(stockItem)
        .where(and(eq(stockItem.productId, l.productId!), eq(stockItem.status, "재고"), isNull(stockItem.dot)))
        .limit(1);
      let stockId: number;
      if (exist) {
        await db
          .update(stockItem)
          .set({ qty: exist.qty + take, verifiedAt: now, purchasePrice: l.unitCost ?? undefined })
          .where(eq(stockItem.id, exist.id));
        stockId = exist.id;
      } else {
        const [ins] = await db
          .insert(stockItem)
          .values({
            stockNo: `S${yy}-${String(seq++).padStart(6, "0")}`,
            productId: l.productId!,
            qty: take,
            status: "재고",
            dot: null,
            purchasePrice: l.unitCost,
            purchaseItemId: l.id,
            verifiedAt: now,
            createdBy: session.uid ?? null,
          })
          .returning({ id: stockItem.id });
        stockId = ins.id;
      }
      await db.insert(stockMovement).values({
        stockItemId: stockId,
        type: "입고",
        reason: "매입입고(붙여넣기)",
        qtyDelta: take,
        memo: `${inv.supplier} ${l.cai}`,
        createdBy: session.uid ?? null,
      });
    }
    received += take;

    await db
      .update(purchaseInvoiceItem)
      .set({ receivedQty: l.qty, receivedAt: now })
      .where(eq(purchaseInvoiceItem.id, l.id));

    /** 한 번이라도 들어왔으면 「미등록」이 아니다 */
    await db.update(product).set({ stockTracked: true }).where(eq(product.id, l.productId!));

    /** ⭐ 매입가 자동 갱신 — 사장님만 (D-05). 입고가 확정된 순간에 갱신한다 */
    if (owner && l.unitCost && l.unitCost !== p.purchasePrice) {
      await db.update(product).set({ purchasePrice: l.unitCost }).where(eq(product.id, l.productId!));
      priceUpdated++;
    }
  }

  await db.execute(sql`
    UPDATE purchase_invoice SET
      status = CASE WHEN EXISTS (SELECT 1 FROM purchase_invoice_item x
                                 WHERE x.invoice_id = ${invoiceId} AND x.received_qty < x.qty)
                    THEN '부분입고' ELSE '입고완료' END,
      updated_at = now()
    WHERE id = ${invoiceId}
  `);

  refresh("/receiving", "/receiving/history", "/stock", "/");
  return { ok: true, received, priceUpdated };
}
