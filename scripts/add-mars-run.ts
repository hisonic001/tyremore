/**
 * mars_run 표 만들기 (2026-08-04) — 웹 버튼 → PC 실행의 연결 고리.
 *   npx tsx scripts/add-mars-run.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS mars_run (
        id           bigserial PRIMARY KEY,
        kind         text NOT NULL DEFAULT '입력' CHECK (kind IN ('입력','점검')),
        status       text NOT NULL DEFAULT '대기' CHECK (status IN ('대기','실행중','완료','실패')),
        log          text,
        requested_by bigint REFERENCES app_user(id),
        requested_at timestamptz NOT NULL DEFAULT now(),
        started_at   timestamptz,
        finished_at  timestamptz
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mars_run_open ON mars_run (status) WHERE status IN ('대기','실행중')`;
    console.log("✅ mars_run 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
