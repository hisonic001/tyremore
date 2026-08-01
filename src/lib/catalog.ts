"use server";

/**
 * 상품 목록 정리 — 숨기기 / 되살리기 (사장님 요청 2026-08-01)
 *
 * > "타이어 목록 중에 너무 쓸데없는 타이어들이 많이 들어있음(단종상품, 받지 않는 브랜드 등).
 * >  재고가 없는 타이어는 우선 데이터베이스 상에서 지워줘. 그리고 향후에 입고되거나
 * >  재고조사 후 입력할 수 있도록 하는 것이 좋을 것 같아."
 *
 * ⚠️ **지우지 않고 끈다.** 두 요구가 서로 부딪히기 때문이다.
 *    지우면 기표가·규격·브랜드·바코드가 함께 사라져서, 나중에 입고할 때
 *    그 상품을 손으로 처음부터 다시 만들어야 한다. 끄면 되살리는 순간 전부 그대로다.
 *    화면에서 안 보인다는 결과는 완전히 같다.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { brand, product, stockItem } from "@/db/schema";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 컨텍스트 밖 (스크립트) — 무시 */
    }
  }
}

/** 개별 상품 숨기기 / 되살리기 */
export async function setProductActive(productId: number, active: boolean) {
  await db
    .update(product)
    .set({ isActive: active, hiddenReason: active ? null : "manual", updatedAt: new Date() })
    .where(eq(product.id, productId));
  refresh("/", `/stock/${productId}`, "/settings/catalog");
  return { ok: true as const };
}

/** 브랜드 통째로 취급/미취급 */
export async function setBrandHandled(code: string, handled: boolean) {
  await db.update(brand).set({ isHandled: handled }).where(eq(brand.code, code));
  refresh("/", "/settings/catalog");
  return { ok: true as const };
}

/**
 * 기표가 없는 타이어를 끈다.
 *
 * 기표가가 없으면 **가격을 계산할 수 없어 견적 자체가 나오지 않는다.**
 * 재고가 없는 것과는 다르다 — 재고가 없어도 기표가만 있으면 주문 판매가 된다.
 * 그래서 "재고 없음"이 아니라 "가격 없음"을 기준으로 잡는다.
 *
 * 단, **재고가 있으면 끄지 않는다.** 창고에 있는 물건이 화면에서 사라지면 안 된다.
 */
export async function hideUnpricedTires() {
  const r = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET is_active = false, hidden_reason = 'no_price', updated_at = now()
      WHERE item_type = 'tire'
        AND is_active = true
        AND (list_price IS NULL OR list_price = 0)
        AND NOT EXISTS (
          SELECT 1 FROM stock_item s WHERE s.product_id = product.id AND s.status = '재고'
        )
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  refresh("/", "/settings/catalog");
  return { hidden: r[0]?.n ?? 0 };
}

/** 되살리기 — 사유별로 한 번에 */
export async function restoreProducts(reason: "no_price" | "manual" | "all") {
  const where =
    reason === "all"
      ? sql`is_active = false`
      : sql`is_active = false AND hidden_reason = ${reason}`;
  const r = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET is_active = true, hidden_reason = NULL, updated_at = now()
      WHERE ${where}
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  refresh("/", "/settings/catalog");
  return { restored: r[0]?.n ?? 0 };
}

export interface CatalogStat {
  brands: { code: string; nameKo: string; isHandled: boolean; total: number; visible: number; inStock: number }[];
  hidden: { reason: string; n: number }[];
  totals: { all: number; visible: number; hidden: number; inStock: number };
}

export async function catalogStats(): Promise<CatalogStat> {
  const brands = await db.execute<{
    code: string;
    name_ko: string;
    is_handled: boolean;
    total: number;
    visible: number;
    in_stock: number;
  }>(sql`
    SELECT b.code, b.name_ko, b.is_handled,
           count(*)::int total,
           count(*) FILTER (WHERE p.is_active)::int visible,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM stock_item s WHERE s.product_id = p.id AND s.status='재고' AND s.qty > 0
           ))::int in_stock
    FROM brand b JOIN product p ON p.brand_code = b.code AND p.item_type = 'tire'
    GROUP BY b.code, b.name_ko, b.is_handled, b.sort_order
    ORDER BY b.sort_order
  `);

  const hidden = await db.execute<{ reason: string | null; n: number }>(sql`
    SELECT hidden_reason reason, count(*)::int n FROM product
    WHERE item_type='tire' AND is_active = false
    GROUP BY hidden_reason ORDER BY n DESC
  `);

  const [t] = await db.execute<{ all: number; visible: number; hidden: number; in_stock: number }>(sql`
    SELECT count(*)::int all,
           count(*) FILTER (WHERE is_active)::int visible,
           count(*) FILTER (WHERE NOT is_active)::int hidden,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM stock_item s WHERE s.product_id = product.id AND s.status='재고' AND s.qty > 0
           ))::int in_stock
    FROM product WHERE item_type='tire'
  `);

  return {
    brands: brands.map((b) => ({
      code: b.code,
      nameKo: b.name_ko,
      isHandled: b.is_handled,
      total: b.total,
      visible: b.visible,
      inStock: b.in_stock,
    })),
    hidden: hidden.map((h) => ({ reason: h.reason ?? "(사유 없음)", n: h.n })),
    totals: { all: t.all, visible: t.visible, hidden: t.hidden, inStock: t.in_stock },
  };
}
