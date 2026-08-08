/**
 * purchase_invoice_item.dot 추가 (사장님 요청 2026-08-08)
 *   "직접담기 진행 중 DOT가 다른 품목이 들어올 수도 있는데 …
 *    품목을 이어서 담는데에 불편함을 느낌."
 * 담을 때부터 줄마다 DOT 를 적어 두면, 같은 상품이라도 DOT 별로 줄을 나눠
 * 담을 수 있고 전량 입고가 그 DOT 그대로 재고에 박는다.
 *   npx tsx scripts/add-purchase-item-dot.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE purchase_invoice_item ADD COLUMN IF NOT EXISTS dot text`;
    console.log("✅ purchase_invoice_item.dot 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
