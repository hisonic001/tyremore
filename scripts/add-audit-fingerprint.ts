/**
 * ⭐ audit_run.fingerprint — 검사 결과가 「어떤 자료 상태」에서 찍혔는지 (2026-09-10)
 *
 *   정합성 검사는 하루 한 번 찍는 사진이라, 오후에 14건을 정리해도 배너는 아침 숫자(29건)를
 *   보여 줬다. 홈 인박스·돈 추적은 실시간이라 같은 건을 두고 화면마다 말이 달랐다.
 *   자료를 바꾸는 서버 액션이 6개 파일 40개가 넘어 하나하나 갱신을 붙이면 빠뜨린다 —
 *   대신 결과를 저장할 때 자료의 지문을 같이 적고, 돈관리를 열 때 지문이 다르면 다시 찍는다.
 *
 *   실행: npx tsx --env-file=.env.local scripts/add-audit-fingerprint.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE audit_run ADD COLUMN IF NOT EXISTS fingerprint text`;
    console.log("✅ audit_run.fingerprint — 검사 결과에 자료 지문");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
