/**
 * purchase_invoice_item.received_at 추가 (사장님 지시 2026-08-08)
 *   "전량입고 혹은 입고확정 버튼을 누르는 때가 입고가 되는 순간이며 …
 *    입고 되는 순간을 기점으로 입고 날짜와 입고 내역을 기록해줘."
 * 이미 입고된 옛 줄들은 발행일(없으면 만든 날)로 채워 둔다 — 그때는 시각을 안 남겼다.
 *   npx tsx scripts/add-received-at.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE purchase_invoice_item ADD COLUMN IF NOT EXISTS received_at timestamptz`;
    const r = await sql`
      UPDATE purchase_invoice_item x
      SET received_at = COALESCE(i.issued_at::timestamptz, i.created_at)
      FROM purchase_invoice i
      WHERE i.id = x.invoice_id AND x.received_qty > 0 AND x.received_at IS NULL
    `;
    console.log(`✅ received_at 준비됨 — 옛 입고 줄 ${r.count}개 백필`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
