/**
 * ERP ⑦ 매입 대금 지급 (미지급금) — receivable_payment 의 거울상 (사장님 지시 2026-08-25)
 *
 *   매입 인보이스에 「언제 얼마 줬나」를 기록한다. 잔액 컬럼은 없다 —
 *   미지급 잔액 = purchase_invoice.total − SUM(purchase_payment.amount) (파생값 원칙).
 *
 *   npx tsx scripts/add-purchase-payment.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_payment (
        id         bigserial PRIMARY KEY,
        invoice_id bigint NOT NULL REFERENCES purchase_invoice(id) ON DELETE CASCADE,
        amount     integer NOT NULL CHECK (amount > 0),
        method     text NOT NULL CHECK (method IN ('계좌이체','현금','카드','기타')),
        paid_on    date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
        memo       text,
        created_by bigint REFERENCES app_user(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_purchase_payment_invoice ON purchase_payment (invoice_id)`;
    console.log("✅ purchase_payment 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
