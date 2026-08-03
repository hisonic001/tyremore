/**
 * 상품별로 따로 저장돼 있던 **판매** 할인율을 비운다 (사장님 지시 2026-08-03).
 *
 *   "새로고침이나 새 창을 열면 25%로 돌아가게 만드는 게 훨씬 나을 것 같아"
 *
 * 상담 화면에서 친 할인율이 자동 저장되던 시절에 쌓인 값들이다. 이제 그 화면은
 * 아무것도 저장하지 않으므로, 남아 있으면 그 상품만 영영 다른 할인율로 열린다.
 *
 * ⚠️ **매입 할인율은 건드리지 않는다.** 인보이스에서 들어온 값이라 원가·마진이 걸려 있다.
 *    줄을 지우는 게 아니라 판매 할인율 칸만 비운다.
 * ⚠️ 품목범주(`category`) 기본 25% 는 그대로 둔다 — 그게 돌아갈 자리다.
 *
 *   npx tsx scripts/clear-item-sales-rates.ts --dry   무엇이 지워질지만 보기
 *   npx tsx scripts/clear-item-sales-rates.ts         실제로 비우기
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const dry = process.argv.includes("--dry");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  const rows = await db.execute<{
    target: string;
    sales: string;
    purchase: string | null;
    name: string | null;
  }>(sql`
    SELECT r.target, r.sales_discount_rate sales, r.purchase_discount_rate purchase,
           COALESCE(p.display_name, p.pattern, p.raw_name) name
    FROM price_rule r
    LEFT JOIN product p ON p.mars_item_no = r.target
    WHERE r.scope = 'item' AND r.sales_discount_rate IS NOT NULL
    ORDER BY r.target
  `);

  if (rows.length === 0) {
    console.log("상품별로 따로 저장된 판매 할인율이 없습니다. 그대로 두면 됩니다.");
    process.exit(0);
  }

  console.log(`상품별 판매 할인율 ${rows.length}건${dry ? " (미리보기)" : ""}:`);
  for (const r of rows) {
    console.log(
      `   ${r.target.padEnd(14)} 판매 ${(Number(r.sales) * 100).toFixed(1)}%` +
        `${r.purchase !== null ? ` · 매입 ${(Number(r.purchase) * 100).toFixed(1)}% (그대로 둠)` : ""}` +
        `   ${r.name ?? ""}`,
    );
  }
  if (dry) {
    console.log("\n--dry 라 아무것도 바꾸지 않았습니다.");
    process.exit(0);
  }

  const done = await db.execute<{ n: number }>(sql`
    WITH u AS (
      UPDATE price_rule SET sales_discount_rate = NULL, updated_at = now()
      WHERE scope = 'item' AND sales_discount_rate IS NOT NULL
      RETURNING 1
    ) SELECT count(*)::int n FROM u
  `);
  console.log(`\n✅ ${done[0]?.n ?? 0}건 비웠습니다 — 이제 기본 할인율로 열립니다.`);

  const [d] = await db.execute<{ scope: string; target: string; sales: string | null }>(
    sql`SELECT scope, target, sales_discount_rate sales FROM price_rule
        WHERE scope='category' AND sales_discount_rate IS NOT NULL LIMIT 1`,
  );
  console.log(
    d
      ? `   기본 할인율: [${d.scope}] ${d.target} → ${(Number(d.sales) * 100).toFixed(1)}%`
      : "   ⚠️ 기본 할인율이 없습니다 — scripts/set-default-rate.ts 25 를 돌려 주세요",
  );
  process.exit(0);
}
main();
