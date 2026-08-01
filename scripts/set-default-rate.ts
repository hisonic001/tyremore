/**
 * 기본 판매 할인율 (사장님 지시 2026-08-01)
 *
 * 타이어 전체에 25% 를 깔아 둔다. 개별 상품·모델·브랜드 규칙이 있으면
 * 그쪽이 이긴다 — 우선순위가 category(4)로 가장 낮기 때문이다 (D-05 4번).
 *
 * 이렇게 해두면 상담 화면이 처음부터 판매가를 말할 수 있고,
 * 다른 값이 필요한 상품만 그때그때 덮어쓰면 된다.
 *
 *   npx tsx scripts/set-default-rate.ts [비율]     예: 25
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const pct = Number(process.argv[2] ?? "25");
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) {
    console.error("비율은 0 이상 100 미만이어야 합니다");
    process.exit(1);
  }
  const rate = pct / 100;

  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { savePriceRule } = await import("../src/lib/pricing");

  // 타이어 품목 범주 전체에 적용 (실데이터상 '10-TIRES')
  const cats = await db.execute<{ category: string; n: number }>(sql`
    SELECT category, count(*)::int n FROM product
    WHERE item_type='tire' AND category IS NOT NULL
    GROUP BY category ORDER BY n DESC
  `);

  for (const c of cats) {
    await savePriceRule({ scope: "category", target: c.category, salesRate: rate });
    console.log(`  ${c.category}  ${c.n.toLocaleString()}건 → 기본 ${pct}%`);
  }

  const rules = await db.execute<{ scope: string; target: string; sales: string | null; n: number }>(sql`
    SELECT scope, target, sales_discount_rate sales, 1 n FROM price_rule ORDER BY priority, target
  `);
  console.log(`\n현재 규칙 ${rules.length}건:`);
  for (const r of rules) {
    console.log(`  [${r.scope}] ${r.target}  판매 ${r.sales !== null ? Number(r.sales) * 100 + "%" : "—"}`);
  }

  // 확인 — 실제로 판매가가 나오는가
  const { findProducts } = await import("../src/lib/search");
  const hits = await findProducts("", { brands: ["MI"], inStock: true });
  console.log("\n적용 확인 (재고 있는 미쉐린):");
  for (const h of hits.slice(0, 5)) {
    console.log(
      `  ${h.model.slice(0, 24).padEnd(26)} ${String(h.listPrice).padStart(9)} → ${String(h.salePrice ?? "—").padStart(9)}` +
        `  (4본 ${h.salePrice ? (h.salePrice * 4).toLocaleString() : "—"})`,
    );
  }
  process.exit(0);
}
main();
