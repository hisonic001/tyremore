/**
 * 기표가 VAT 반영 (사장님 요청 2026-08-01)
 *
 * MARS 「단가1」은 VAT 미포함이다. 기표가는 고객에게 말하는 금액이므로
 * 세금이 들어 있어야 한다. 그대로 띄우면 상담 중에 10% 낮은 금액을 부르게 된다.
 *
 * ⚠️ 원본은 `list_price_excl` 에 그대로 남는다. 되돌릴 수 있다.
 *    이 스크립트는 여러 번 돌려도 결과가 같다 — 항상 원본에서 다시 계산한다.
 *
 *   npx tsx scripts/apply-vat.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { VAT_EXCLUDED_BRANDS } = await import("./import/seed-data");

  // 1) 원본 보존 — 아직 안 채워진 것만 (이미 VAT를 먹인 값을 원본으로 착각하면 안 된다)
  const back = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product SET list_price_excl = list_price
      WHERE list_price_excl IS NULL AND list_price IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  console.log(`원본 보존 (list_price_excl): ${back[0].n.toLocaleString()}건`);

  // 2) 브랜드 설정
  // ⚠️ `= ANY(${배열})` 은 postgres.js 가 스칼라로 직렬화해 깨진다. inArray 를 쓴다.
  const { brand } = await import("../src/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.update(brand).set({ priceExcludesVat: false });
  await db.update(brand).set({ priceExcludesVat: true }).where(inArray(brand.code, VAT_EXCLUDED_BRANDS));
  const bs = await db.execute<{ name_ko: string }>(
    sql`SELECT name_ko FROM brand WHERE price_excludes_vat ORDER BY sort_order`,
  );
  console.log(`VAT 가산 브랜드: ${bs.map((b) => b.name_ko).join(", ") || "없음"}`);

  // 3) 항상 원본에서 다시 계산 — 여러 번 돌려도 같은 결과
  const r = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE product p SET
        list_price = CASE WHEN b.price_excludes_vat
                          THEN round(p.list_price_excl * 1.1)::int
                          ELSE p.list_price_excl END,
        updated_at = now()
      FROM brand b
      WHERE b.code = p.brand_code AND p.list_price_excl IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  console.log(`기표가 재계산: ${r[0].n.toLocaleString()}건\n`);

  // 4) 결과 확인
  const chk = await db.execute<{ cai: string; pattern: string; excl: number; incl: number }>(sql`
    SELECT p.mars_item_no cai, p.pattern, p.list_price_excl excl, p.list_price incl
    FROM product p WHERE p.brand_code='MI' AND p.list_price_excl > 0
      AND EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id=p.id AND s.status='재고')
    ORDER BY p.list_price DESC LIMIT 6
  `);
  console.log("재고 있는 미쉐린 (VAT 전 → 후):");
  for (const c of chk) {
    console.log(
      `   ${c.cai}  ${String(c.pattern).slice(0, 24).padEnd(26)} ${c.excl.toLocaleString().padStart(10)} → ${c.incl.toLocaleString().padStart(10)}`,
    );
  }

  const [odd] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM product WHERE brand_code='MI' AND list_price % 100 <> 0 AND list_price > 0
  `);
  console.log(`\n미쉐린 중 100원 단위로 안 떨어지는 것: ${odd.n}건 ${odd.n === 0 ? "✅" : "⚠️"}`);
  process.exit(0);
}
main();
