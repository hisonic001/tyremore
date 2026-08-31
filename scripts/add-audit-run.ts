/**
 * ⭐ audit_run — 매일 자동 감사 결과 기록표 (돈관리 근본책 1단계-B, 2026-08-31)
 *   실행: npx tsx scripts/add-audit-run.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS audit_run (
        id         bigserial PRIMARY KEY,
        at         timestamptz NOT NULL DEFAULT now(),
        item_count int         NOT NULL,
        items      jsonb       NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_run_at ON audit_run (at DESC)`;
    console.log("✅ audit_run — 자동 감사 기록표");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
