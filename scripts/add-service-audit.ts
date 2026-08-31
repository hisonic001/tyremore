/**
 * ⭐ service_item 에 만든 흔적 칸을 붙인다 (공임·정비 목록 관리 화면, 사장님 요청 2026-08-31)
 *
 *   지금까지 69건은 전부 MARS 이관으로 들어와 흔적이 필요 없었다.
 *   이제 화면에서 만들고 고칠 수 있게 되므로 — 언제·누가 만들었는지가 있어야
 *   나중에 「이 공임 누가 넣었지?」에 답할 수 있다 (recon_match_gone 과 같은 이치).
 *
 *   · created_at  — 기존 69건은 이 스크립트를 돌린 시각이 아니라 **NULL 로 둔다**
 *                   (이관분과 화면에서 만든 것을 구분하는 표시가 된다)
 *   · updated_at  — 화면에서 고칠 때만 채운다
 *   · created_by  — 화면에서 만든 사람 (app_user)
 *
 * 🔴 코드 배포 **전에** 실행한다 — 컬럼이 없으면 관리 화면 저장이 죽는다.
 *   실행: npx tsx scripts/add-service-audit.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE service_item ADD COLUMN IF NOT EXISTS created_at timestamptz`;
    await sql`ALTER TABLE service_item ADD COLUMN IF NOT EXISTS updated_at timestamptz`;
    await sql`ALTER TABLE service_item ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES app_user(id)`;
    const [n] = await sql`SELECT count(*)::int n FROM service_item`;
    console.log(`✅ service_item 흔적 칸 3개 (지금 ${n.n}건 — 이관분은 created_at NULL 로 남는다)`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
