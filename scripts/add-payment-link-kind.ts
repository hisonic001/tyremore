/**
 * 감사수리 배치C — recon_match kind 에 '매입지급' 추가 (2026-08-25)
 *   '매입대금' 통장 출금 ↔ purchase_invoice 지급을 잇는 연결 자국용.
 *   npx tsx scripts/add-payment-link-kind.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`ALTER TABLE recon_match DROP CONSTRAINT IF EXISTS recon_match_kind`;
    await sql`ALTER TABLE recon_match ADD CONSTRAINT recon_match_kind
      CHECK (kind IN ('매입계산서','매출계산서','이체입금','카드정산입금','카드승인','매입지급'))`;
    console.log("✅ recon_match kind '매입지급' 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
