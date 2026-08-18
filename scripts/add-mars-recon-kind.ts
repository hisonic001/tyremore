/**
 * mars_run.kind 에 '대사' 허용 (2026-08-18 — 근본 개선 단계3, 사장님 승인 「매일 자동」)
 *
 * 대사(對査) = 앱의 전송완료 기록 ↔ MARS 송장 목록을 검색으로 대조해서
 * 틀린 기록(수동확인·전기실패 잔존)을 우리 DB 쪽만 바로잡는다. MARS 에는 안 쓴다.
 * 실행: npx tsx scripts/add-mars-recon-kind.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE mars_run DROP CONSTRAINT IF EXISTS mars_run_kind`;
    await sql`ALTER TABLE mars_run DROP CONSTRAINT IF EXISTS mars_run_kind_check`;
    await sql`ALTER TABLE mars_run ADD CONSTRAINT mars_run_kind CHECK (kind IN ('입력','점검','자가점검','대사'))`;
    console.log("✅ mars_run.kind 에 대사 허용됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
