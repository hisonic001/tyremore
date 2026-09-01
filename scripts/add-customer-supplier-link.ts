/**
 * ⭐ customer.supplier_name — 「거래처 차고」 링크 (사장님 요청 2026-09-01)
 *
 *   거래처(쏘카·AJ렌트카 등)의 차량을 담는 고객 행을 거래처와 **링크로** 잇는다 —
 *   이름 비교가 아니라서 동명 실제 손님과 절대 안 섞인다 (2026-08-08 「동명 안 합침」 결정 준수).
 *   거래처당 차고 고객은 최대 1 (부분 유니크).
 *
 * 🔴 코드 배포 전에 실행. 실행: npx tsx scripts/add-customer-supplier-link.ts (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE customer ADD COLUMN IF NOT EXISTS supplier_name text`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_supplier ON customer (supplier_name) WHERE supplier_name IS NOT NULL`;
    console.log("✅ customer.supplier_name — 거래처 차고 링크");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
