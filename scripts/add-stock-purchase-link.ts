/**
 * stock_item.purchase_item_id 추가 (2026-08-09)
 *
 * 사장님 요청: "매입내역에서 수정이나 지우기도 가능하게 만들어줘."
 * 입고를 되돌리려면 **이 재고가 어느 매입 줄에서 왔는지** 알아야 한다.
 * 지금까지는 연결이 없어 되짚을 수 없었다 — 앞으로 입고되는 본부터 여기 남는다.
 * (기존 재고는 비어 있다 — 지우기는 상품·DOT·매입가로 맞춰 찾는 보조 길을 쓴다.)
 * 실행: npx tsx scripts/add-stock-purchase-link.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE stock_item ADD COLUMN IF NOT EXISTS purchase_item_id bigint`;
    await sql`CREATE INDEX IF NOT EXISTS idx_stock_purchase_item
              ON stock_item (purchase_item_id) WHERE purchase_item_id IS NOT NULL`;
    console.log("✅ stock_item.purchase_item_id 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
