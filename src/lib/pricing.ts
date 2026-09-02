"use server";

/**
 * 가격 계산 — D-05
 *
 *               기표가 (MARS 확보 · VAT 포함)
 *         ┌───────────┴───────────┐
 *    매입 할인율              판매 할인율
 *         ↓                       ↓
 *    매입 원가              가이드 판매가 → 현장 재량 조정 → 최종 판매가
 *         └───────────┬───────────┘
 *                  마진
 *
 * 핵심 원칙
 *  1. 할인율을 **미리 채우지 않는다.** 10,691건을 사전 입력할 수 없고 그럴 필요도 없다.
 *     공란으로 시작해 상담 화면에서 입력하면 마스터가 저절로 완성된다.
 *  2. **양방향 계산.** 정비사는 "25% 빼줘"라고도, "18만 9천"이라고도 생각한다.
 *  3. 적용 우선순위 **개별상품 > 패턴/모델 > 브랜드 > 품목범주** — 좁은 것이 이긴다.
 *  4. **현장 재량 오버라이드를 막지 않는다.** 막으면 직원이 시스템을 안 쓴다.
 *  5. 매입원가·마진은 사장님만 본다.
 *
 * ⚠️ 세금 기준을 섞으면 안 된다.
 *    기표가·판매가는 **VAT 포함**, 매입원가는 **VAT 미포함**(공장도가 기준)이다.
 *    마진은 공급가액끼리 비교한다 → 판매가÷1.1 − 매입원가
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { priceRule, product } from "@/db/schema";
import { hasPerm } from "./auth";
import { savePriceRuleCore } from "./pricing-core";

export type RuleScope = "item" | "pattern" | "brand" | "category";

function refresh(...paths: string[]) {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export interface PriceInfo {
  /** 기표가 (VAT 포함) */
  listPrice: number | null;
  /** 기표가 (VAT 미포함) — 매입 계산의 기준 */
  listPriceExcl: number | null;

  /** 적용된 판매 할인율 (0.25 = 25%) */
  salesRate: number | null;
  /** 판매가 (VAT 포함) */
  salePrice: number | null;

  /** 매입 할인율 */
  purchaseRate: number | null;
  /** 매입 원가 (VAT 미포함) */
  purchaseCost: number | null;

  /** 마진 (공급가액 기준) */
  margin: number | null;
  /** 마진율 (판매 공급가액 대비) */
  marginRate: number | null;

  /** 어느 범위 규칙이 적용됐나 */
  appliedScope: RuleScope | null;
  appliedTarget: string | null;

  /** 저장 범위 선택지 */
  scopes: { scope: RuleScope; target: string; label: string }[];
}

/** 원 단위 반올림 */
const won = (n: number) => Math.round(n);

export async function getPrice(productId: number): Promise<PriceInfo | null> {
  /**
   * 🔴 매입원가·마진이 담긴다 — 사장님만 (D-05 5번, 2026-08-08 코드 리뷰로 발견).
   *    "use server" export 는 로그인만 있으면 누구나 부를 수 있는 끝점이라
   *    여기서 직접 막아야 한다. 화면에서 감추는 것으로는 부족하다.
   */
  if (!(await hasPerm("master"))) return null;
  const [p] = await db.execute<{
    mars_item_no: string | null;
    pattern: string | null;
    brand_code: string | null;
    brand_name: string | null;
    category: string | null;
    list_price: number | null;
    list_price_excl: number | null;
  }>(sql`
    SELECT p.mars_item_no, p.pattern, p.brand_code, b.name_ko brand_name,
           p.category, p.list_price, p.list_price_excl
    FROM product p LEFT JOIN brand b ON b.code = p.brand_code
    WHERE p.id = ${productId}
  `);
  if (!p) return null;

  /**
   * 좁은 것이 이긴다 — priority 순으로 첫 줄만.
   *
   * 🔴 판매·매입을 **따로** 찾는다 (2026-08-03).
   *    예전에는 한 번에 한 줄만 뽑아 두 값을 다 읽었다. 그래서
   *      · 개별 상품에 매입 할인율만 있는 줄이 있으면 그 줄이 이겨 버려서
   *        판매 할인율이 `null` 이 되고, **기본 25% 가 안 먹었다.**
   *      · 반대로 판매만 있는 줄이 이기면 브랜드 매입 할인율이 묻혔다.
   *    값이 실제로 들어 있는 줄만 골라 각자 찾으면 둘 다 제대로 적용된다.
   */
  const pick = async (col: "sales_discount_rate" | "purchase_discount_rate") => {
    const [r] = await db.execute<{ scope: RuleScope; target: string; v: string | null }>(sql`
      SELECT scope, target, ${sql.raw(col)} AS v
      FROM price_rule
      WHERE ${sql.raw(col)} IS NOT NULL
        AND ( (scope = 'item'     AND target = ${p.mars_item_no ?? ""})
           OR (scope = 'pattern'  AND target = ${p.pattern ?? ""})
           OR (scope = 'brand'    AND target = ${p.brand_code ?? ""})
           OR (scope = 'category' AND target = ${p.category ?? ""}) )
      ORDER BY priority
      LIMIT 1
    `);
    return r ? { scope: r.scope, target: r.target, rate: Number(r.v) } : null;
  };

  const sales = await pick("sales_discount_rate");
  const purchase = await pick("purchase_discount_rate");

  const salesRate = sales?.rate ?? null;
  const purchaseRate = purchase?.rate ?? null;

  const listPrice = p.list_price;
  const listPriceExcl = p.list_price_excl;

  const salePrice = listPrice !== null && salesRate !== null ? won(listPrice * (1 - salesRate)) : null;
  const purchaseCost =
    listPriceExcl !== null && purchaseRate !== null ? won(listPriceExcl * (1 - purchaseRate)) : null;

  // ⚠️ 공급가액끼리 비교한다. 판매가는 VAT 포함, 매입원가는 VAT 미포함이다
  const margin =
    salePrice !== null && purchaseCost !== null ? won(salePrice / 1.1 - purchaseCost) : null;
  const marginRate =
    margin !== null && salePrice !== null && salePrice > 0 ? margin / (salePrice / 1.1) : null;

  const scopes: PriceInfo["scopes"] = [];
  if (p.mars_item_no) scopes.push({ scope: "item", target: p.mars_item_no, label: "이 상품만" });
  if (p.pattern) {
    scopes.push({ scope: "pattern", target: p.pattern, label: `이 모델 전체` });
  }
  if (p.brand_code) {
    scopes.push({ scope: "brand", target: p.brand_code, label: `${p.brand_name ?? p.brand_code} 전체` });
  }

  return {
    listPrice,
    listPriceExcl,
    salesRate,
    salePrice,
    purchaseRate,
    purchaseCost,
    margin,
    marginRate,
    appliedScope: sales?.scope ?? null,
    appliedTarget: sales?.target ?? null,
    scopes,
  };
}

/**
 * ⭐ 할인율 저장 — 양방향 입력의 결과를 받는다.
 * 할인율을 넣었든 판매가를 넣었든, 여기 도달할 때는 **비율**로 환산돼 있다.
 */
export async function savePriceRule(input: {
  scope: RuleScope;
  target: string;
  salesRate?: number | null;
  purchaseRate?: number | null;
  productId?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  /**
   * 🔴 할인율 규칙은 판매가를 통째로 움직인다 — 사장님만 (2026-08-08 코드 리뷰).
   *    본체는 pricing-core.savePriceRuleCore 로 옮겼다 — 인보이스 업로드가
   *    서버 안에서 쓰는 길은 권한과 무관하게 계속 돌아야 해서다.
   */
  if (!(await hasPerm("master"))) return { ok: false, error: "사장님 계정에서만 할 수 있습니다" };

  const r = await savePriceRuleCore(input);
  if (!r.ok) return r;
  if (input.productId) refresh(`/stock/${input.productId}`);
  refresh("/");
  return { ok: true };
}

/** 규칙 삭제 — 다시 「미설정」으로 돌린다. 사장님만 (2026-08-08) */
export async function clearPriceRule(
  scope: RuleScope,
  target: string,
  productId?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("master"))) return { ok: false, error: "사장님 계정에서만 할 수 있습니다" };
  await db.delete(priceRule).where(and(eq(priceRule.scope, scope), eq(priceRule.target, target)));
  if (productId) refresh(`/stock/${productId}`);
  refresh("/");
  return { ok: true };
}

/** 판매가 → 할인율 (양방향 계산의 반대 방향) */
export async function rateFromPrice(listPrice: number, price: number): Promise<number> {
  if (listPrice <= 0) return 0;
  return Math.max(0, Math.min(0.999, 1 - price / listPrice));
}
