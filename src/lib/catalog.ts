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
import { hasPerm } from "./auth";

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
  refresh("/", `/stock/${productId}`, "/settings/products");
  return { ok: true as const };
}

/**
 * ⭐ 화면 표시 이름 직접 정하기 (사장님 요청 2026-08-01)
 *
 * MARS 원문에 `PILSP3`, `PRIM MXM4`, `P SPT CUP2` 같은 축약이 섞여 있어
 * 자동으로는 못 편다. 비우면 자동 생성 이름으로 돌아간다.
 *
 * ⚠️ `raw_name`·`pattern` 은 건드리지 않는다. MARS 입력은 원문으로 해야 한다 (D-08).
 */
export async function setDisplayName(productId: number, name: string | null) {
  // 🔴 2026-08-27: 같은 파일의 setListPrice·hideUnpricedTires 는 전부 isOwner() 가 있는데
  //    이것만 빠져 있었다 — 손님에게 보이는 이름을 아무 계정이나 바꿀 수 있었다
  if (!(await hasPerm("master"))) return { ok: false as const, error: "사장님 계정에서만 할 수 있습니다" };
  const v = name?.trim() || null;
  await db.update(product).set({ displayName: v, updatedAt: new Date() }).where(eq(product.id, productId));
  refresh("/", `/stock/${productId}`, "/settings/products");
  return { ok: true as const };
}

/**
 * ⭐ 기표가(공장도가) 직접 조정 (사장님 요청 2026-08-08)
 *
 *   "판매사에서 기표가(공장도가)를 인상할 때도 있거든."
 *
 * 입력은 화면에 보이는 그대로 **VAT 포함** 값이다. VAT 제외값도 같이 맞춘다.
 * 기표가는 판매가 계산의 출발점(기표가 × (1−할인율))이라, 바꾸면 검색 카드의
 * 판매가가 바로 따라 바뀐다. 비우면 「기표가 모름」으로 돌아간다.
 */
export async function setListPrice(
  productId: number,
  inclVat: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 🔴 기표가는 고객에게 말하는 가격의 출발점 — 사장님만 (2026-08-08 코드 리뷰)
  if (!(await hasPerm("master"))) return { ok: false, error: "사장님 계정에서만 할 수 있습니다" };
  if (inclVat !== null && (!Number.isFinite(inclVat) || inclVat < 0 || inclVat > 100_000_000)) {
    return { ok: false, error: "기표가가 올바르지 않습니다" };
  }
  const v = inclVat && inclVat > 0 ? Math.round(inclVat) : null;

  /**
   * 🔴 VAT 제외값은 **브랜드 방식대로** 맞춘다 (2026-08-08 코드 리뷰).
   *    price_excludes_vat=true 브랜드(미쉐린식)만 ÷1.1 이고, VAT 포함 단가
   *    브랜드는 excl 에도 같은 값이 들어가야 한다 — 무조건 ÷1.1 하면
   *    원가 계산·인보이스 대조가 10% 낮은 기준으로 돌아간다.
   */
  const [b] = await db.execute<{ vat: boolean }>(sql`
    SELECT COALESCE(b.price_excludes_vat, false) vat
    FROM product p LEFT JOIN brand b ON b.code = p.brand_code
    WHERE p.id = ${productId}
  `);
  const excl = v ? (b?.vat ? Math.round(v / 1.1) : v) : null;

  await db
    .update(product)
    .set({ listPrice: v, listPriceExcl: excl, updatedAt: new Date() })
    .where(eq(product.id, productId));
  refresh("/", `/stock/${productId}`);
  return { ok: true };
}

/** 브랜드 통째로 취급/미취급 */
export async function setBrandHandled(code: string, handled: boolean) {
  await db.update(brand).set({ isHandled: handled }).where(eq(brand.code, code));
  refresh("/", "/settings/products");
  return { ok: true as const };
}

/**
 * ⭐ 브랜드의 MARS 단가가 VAT 미포함인지 지정하고, 기표가를 다시 계산한다.
 *
 * 기표가는 고객에게 말하는 금액이다. VAT가 빠져 있으면 상담 중에 10% 낮은
 * 금액을 부르게 된다. 원본(list_price_excl)은 건드리지 않으므로 언제든 되돌린다.
 */
export async function setBrandVatExcluded(code: string, excludes: boolean) {
  // 🔴 브랜드 전체 기표가를 일괄로 바꾼다 — 사장님만 (2026-08-08 코드 리뷰)
  if (!(await hasPerm("master"))) return { ok: false as const, error: "사장님 계정에서만 할 수 있습니다" };
  await db.update(brand).set({ priceExcludesVat: excludes }).where(eq(brand.code, code));
  const r = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET
        list_price = ${excludes ? sql`round(list_price_excl * 1.1)::int` : sql`list_price_excl`},
        updated_at = now()
      WHERE brand_code = ${code} AND list_price_excl IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  refresh("/", "/settings/products");
  return { ok: true as const, updated: r[0]?.n ?? 0 };
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
export async function hideUnpricedTires(): Promise<{ hidden: number; error?: string }> {
  // 🔴 상품을 무더기로 숨긴다 — 사장님만 (2026-08-08 코드 리뷰)
  if (!(await hasPerm("master"))) return { hidden: 0, error: "사장님 계정에서만 할 수 있습니다" };
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
  refresh("/", "/settings/products");
  return { hidden: r[0]?.n ?? 0 };
}

/** 되살리기 — 사유별로 한 번에 */
export async function restoreProducts(
  reason: "no_price" | "manual" | "all",
): Promise<{ restored: number; error?: string }> {
  // 🔴 숨긴 상품을 무더기로 되살린다 — 사장님만 (2026-08-08 코드 리뷰)
  if (!(await hasPerm("master"))) return { restored: 0, error: "사장님 계정에서만 할 수 있습니다" };
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
  refresh("/", "/settings/products");
  return { restored: r[0]?.n ?? 0 };
}

export interface CatalogStat {
  brands: {
    code: string;
    nameKo: string;
    isHandled: boolean;
    vatExcluded: boolean;
    total: number;
    visible: number;
    inStock: number;
  }[];
  hidden: { reason: string; n: number }[];
  totals: { all: number; visible: number; hidden: number; inStock: number };
}

export async function catalogStats(): Promise<CatalogStat> {
  const brands = await db.execute<{
    code: string;
    name_ko: string;
    is_handled: boolean;
    price_excludes_vat: boolean;
    total: number;
    visible: number;
    in_stock: number;
  }>(sql`
    SELECT b.code, b.name_ko, b.is_handled, b.price_excludes_vat,
           count(*)::int total,
           count(*) FILTER (WHERE p.is_active)::int visible,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM stock_item s WHERE s.product_id = p.id AND s.status='재고' AND s.qty > 0
           ))::int in_stock
    FROM brand b JOIN product p ON p.brand_code = b.code AND p.item_type = 'tire'
    GROUP BY b.code, b.name_ko, b.is_handled, b.price_excludes_vat, b.sort_order
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
      vatExcluded: b.price_excludes_vat,
      total: b.total,
      visible: b.visible,
      inStock: b.in_stock,
    })),
    hidden: hidden.map((h) => ({ reason: h.reason ?? "(사유 없음)", n: h.n })),
    totals: { all: t.all, visible: t.visible, hidden: t.hidden, inStock: t.in_stock },
  };
}
