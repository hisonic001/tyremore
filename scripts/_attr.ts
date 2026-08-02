import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { findProducts } = await import("../src/lib/search");

  const [c] = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT p.id)::int n FROM product p
    JOIN stock_item s ON s.product_id = p.id
    WHERE p.brand_code='MI' AND p.is_active AND s.status='재고' AND s.qty > 0
  `);
  console.log(`재고 있는 미쉐린 실제: ${c.n}종`);

  const r = await findProducts("", { brands: ["MI"], inStock: true });
  console.log(`findProducts 결과:   ${r.length}건  (limit 60)`);

  if (c.n > r.length) {
    console.log(`\n⚠️ ${c.n - r.length}종이 안 나온다 — limit 때문인지 확인`);
  }

  const ids = new Set(r.map((x) => x.productId));
  const missing = await db.execute<{ id: number; pattern: string; qty: number }>(sql`
    SELECT p.id, COALESCE(p.display_name,p.pattern) pattern,
           SUM(s.qty)::int qty
    FROM product p JOIN stock_item s ON s.product_id=p.id
    WHERE p.brand_code='MI' AND p.is_active AND s.status='재고' AND s.qty>0
    GROUP BY p.id, p.display_name, p.pattern
    ORDER BY p.id
  `);
  const notShown = missing.filter((m) => !ids.has(Number(m.id)));
  console.log(`\n안 나온 것 ${notShown.length}종:`);
  for (const m of notShown.slice(0, 6)) console.log(`   ${m.id} ${m.pattern} ${m.qty}본`);
  process.exit(0);
}
main();
