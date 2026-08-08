/**
 * 가격 규칙 저장의 핵심부 — 권한 확인 없는 내부용 (2026-08-08 보안 정비)
 *
 * 🔴 pricing.ts 는 "use server" 라 모든 export 가 네트워크로 호출 가능한 끝점이다.
 *    사장님 전용 기능에 isOwner() 문지기를 세우면서, **인보이스 업로드가 서버 안에서
 *    쓰는 길**은 따로 남겨야 했다 — 정비사가 인보이스를 올려도 할인율 갱신은
 *    끊기지 않아야 한다. 이 파일은 "use server" 가 아니라 끝점이 되지 않는다.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { priceRule } from "@/db/schema";
import type { RuleScope } from "./pricing";

export const RULE_PRIORITY: Record<RuleScope, number> = { item: 1, pattern: 2, brand: 3, category: 4 };

export async function savePriceRuleCore(input: {
  scope: RuleScope;
  target: string;
  salesRate?: number | null;
  purchaseRate?: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { scope, target } = input;
  if (!target) return { ok: false, error: "저장 대상이 비어 있습니다" };

  const bad = (r: number | null | undefined) => r !== null && r !== undefined && (r < 0 || r >= 1);
  if (bad(input.salesRate) || bad(input.purchaseRate)) {
    return { ok: false, error: "할인율은 0% 이상 100% 미만이어야 합니다" };
  }

  /**
   * ⚠️ `ON CONFLICT` 를 쓸 수 없다 — UNIQUE(scope, target, supplier_code)의
   *    supplier_code 가 NULL 이면 유니크가 안 걸린다 (2026-08-01 발견).
   *    직접 찾아 갱신한다. 기존 값을 지우지 않는다 — 판매 할인율만 넣어도
   *    매입 할인율은 남아야 한다.
   */
  const [existing] = await db
    .select({ id: priceRule.id })
    .from(priceRule)
    .where(and(eq(priceRule.scope, scope), eq(priceRule.target, target)))
    .limit(1);

  const num = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.salesRate !== undefined) set.salesDiscountRate = num(input.salesRate);
    if (input.purchaseRate !== undefined) set.purchaseDiscountRate = num(input.purchaseRate);
    await db.update(priceRule).set(set).where(eq(priceRule.id, existing.id));
  } else {
    await db.insert(priceRule).values([
      {
        scope,
        target,
        priority: RULE_PRIORITY[scope],
        salesDiscountRate: num(input.salesRate),
        purchaseDiscountRate: num(input.purchaseRate),
      },
    ]);
  }
  return { ok: true };
}
