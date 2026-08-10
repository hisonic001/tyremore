/**
 * mars_run.kind 에 '자가점검' 허용 (2026-08-10 — 자동입력 개선 전략)
 * 실행: npx tsx scripts/add-mars-selfcheck-kind.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // 실 DB 의 제약 이름은 mars_run_kind_check (이름 없이 만들어져 자동 명명됨) — 둘 다 걷어낸다
    await sql`ALTER TABLE mars_run DROP CONSTRAINT IF EXISTS mars_run_kind`;
    await sql`ALTER TABLE mars_run DROP CONSTRAINT IF EXISTS mars_run_kind_check`;
    await sql`ALTER TABLE mars_run ADD CONSTRAINT mars_run_kind CHECK (kind IN ('입력','점검','자가점검'))`;
    console.log("✅ mars_run.kind 에 자가점검 허용됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
