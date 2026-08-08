/**
 * quote.mileage 추가 (사장님 요청 2026-08-08) — "정비내역 카드에서 차량 키로수도".
 * 판매 등록 때 입력한 주행거리를 그 판매에 박아 둔다 — 차량의 최신값과 달리
 * 「그때 몇 km 였나」가 남는다. 과거 건은 비어 있고 화면이 차량 최근값으로 대신한다.
 *   npx tsx scripts/add-quote-mileage.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS mileage integer`;
    console.log("✅ quote.mileage 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
