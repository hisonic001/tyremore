/**
 * receivable_payment 표 추가 (2026-08-11)
 *
 * 사장님 선택: "외상·수금 관리" — 외상 판매의 수금 기록.
 * 잔액은 quote.total_amount − SUM(amount) 로 파생 (별도 잔액 컬럼 없음).
 * 실행: npx tsx scripts/add-receivable-payment.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`CREATE TABLE IF NOT EXISTS receivable_payment (
      id bigserial PRIMARY KEY,
      quote_id bigint NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
      amount integer NOT NULL CHECK (amount > 0),
      method text NOT NULL CHECK (method IN ('현금','카드','계좌이체','지역화폐')),
      paid_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_receivable_quote ON receivable_payment (quote_id)`;
    console.log("✅ receivable_payment 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
