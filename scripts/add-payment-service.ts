/**
 * 결제 방법에 「서비스」 추가 (사장님 요청 2026-08-07)
 *   "단골고객이나 무상으로 점검이나 가벼운 서비스를 해주는 경우도 있음."
 * quote.payment_method 의 체크 제약을 새 목록으로 갈아 끼운다.
 *   npx tsx scripts/add-payment-service.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote DROP CONSTRAINT IF EXISTS quote_payment_method`;
    await sql`ALTER TABLE quote ADD CONSTRAINT quote_payment_method
      CHECK (payment_method IS NULL OR payment_method IN ('현금','카드','계좌이체','외상','혼합','서비스'))`;
    console.log("✅ quote.payment_method 에 '서비스' 허용됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
