/**
 * ERP 구조화 배치4 — 월 마감 (사장님 승인 2026-08-25)
 *
 *   스냅샷 대신 상태 플래그 + 마감 당시 머리숫자(jsonb) — 행 수는 연 12개.
 *   npx tsx scripts/add-month-close.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS month_close (
        ym         text PRIMARY KEY CHECK (ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
        closed_at  timestamptz NOT NULL DEFAULT now(),
        closed_by  bigint REFERENCES app_user(id),
        headline   jsonb NOT NULL
      )`;
    console.log("✅ month_close 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
