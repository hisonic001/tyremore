/**
 * product.min_qty 추가 (2026-08-11) — 부품 재주문점.
 * 이 수량 이하로 떨어지면 재고 화면에 「부족」이 뜬다. NULL = 알림 안 함.
 * 실행: npx tsx scripts/add-product-min-qty.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE product ADD COLUMN IF NOT EXISTS min_qty integer`;
    console.log("✅ product.min_qty 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
