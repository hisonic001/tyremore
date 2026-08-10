/**
 * quote_payment 표 + 지역화폐 결제수단 (2026-08-10)
 *
 * 사장님 요청: "혼합 결제라고 하기보다는 결제시 결제수단을 1개 이상 고르게 할 수
 * 있으며 동시에 반영가능하게. 정비내역이나 다른 보고서들에서 잘 필터링되도록."
 * 추가: "지역화폐 결제수단도 추가해줘. 지역화폐는 MARS에는 그냥 현금으로."
 *
 * 결제수단을 2개 이상 고르면 수단별 금액이 quote_payment 에 한 줄씩 남는다.
 * quote.payment_method 는 그때 '혼합' — 옛 화면·MARS 스크립트와의 호환용이다.
 * 1개짜리 결제는 지금처럼 quote.payment_method 만 쓴다 (이 표는 비어 있음).
 * 실행: npx tsx scripts/add-quote-payment.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`CREATE TABLE IF NOT EXISTS quote_payment (
      id bigserial PRIMARY KEY,
      quote_id bigint NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
      method text NOT NULL,
      amount integer NOT NULL CHECK (amount > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_quote_payment_quote ON quote_payment (quote_id)`;
    // 지역화폐 포함으로 제약을 다시 건다 (처음 만든 판에는 지역화폐가 없었다)
    await sql`ALTER TABLE quote_payment DROP CONSTRAINT IF EXISTS quote_payment_method_check`;
    await sql`ALTER TABLE quote_payment ADD CONSTRAINT quote_payment_method_check
              CHECK (method IN ('현금','카드','계좌이체','지역화폐'))`;
    await sql`ALTER TABLE quote DROP CONSTRAINT IF EXISTS quote_payment_method`;
    await sql`ALTER TABLE quote ADD CONSTRAINT quote_payment_method
              CHECK (payment_method IS NULL OR payment_method IN ('현금','카드','계좌이체','지역화폐','외상','혼합','서비스'))`;
    console.log("✅ quote_payment + 지역화폐 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
