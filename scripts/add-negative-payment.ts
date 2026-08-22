/**
 * quote_payment.amount 에 마이너스 허용 (사장님 요청 2026-08-21 — 카드 취소·환불)
 *
 * 「카드 −100,000 + 현금 100,000」(수단 바꿔 줌)이나 환불 판매(합계 마이너스)를
 * 분할 결제로 적을 수 있게 한다. 0 은 여전히 막는다 — 0원 수단은 빼고 적는다.
 * 실행: npx tsx scripts/add-negative-payment.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote_payment DROP CONSTRAINT IF EXISTS quote_payment_amount_check`;
    await sql`ALTER TABLE quote_payment ADD CONSTRAINT quote_payment_amount_check CHECK (amount <> 0)`;
    console.log("✅ quote_payment.amount — 마이너스 허용 (0 만 막음)");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
