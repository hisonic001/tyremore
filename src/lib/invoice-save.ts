/**
 * ⭐ 인보이스 저장 정본 — 권한 검사 없음 (2026-11-17, D-41)
 *
 *   화면(invoice.saveInvoice — 권한 「receiving」을 본 뒤 여기로) · 메일 자동 수집(/api/intake — 비밀키로 들어온 요청) ·
 *   PC 수집기(scripts/collect.ts) 가 모두 이것을 부른다.
 *   🔴 "use server" 파일에 두지 않는다 — 거기 두면 화면에서 권한 없이 부를 수 있는 서버 액션이 된다.
 *
 *   하는 일: 읽기(invoice.previewInvoice) → 이미 등록된 것 건너뛰기 → 입고 대기 등록 → 매입 할인율·기표가 갱신
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { purchaseInvoice, purchaseInvoiceItem } from "@/db/schema";
import { previewInvoice } from "./invoice";
// 권한 없는 내부용 — 정비사가 인보이스를 올려도 할인율 갱신이 끊기지 않게 (2026-08-08)
import { savePriceRuleCore } from "./pricing-core";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖(수집기) */
    }
  }
}

export async function saveInvoiceCore(
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
