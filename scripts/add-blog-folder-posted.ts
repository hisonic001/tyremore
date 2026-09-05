/**
 * 사진 폴더에 **「블로그에 올렸음」 표시** (2026-09-05, 사장님 지적)
 *
 * 🔴 무엇이 잘못됐었나: 폴더 목록의 「아직 안 올림」이 **폴더 이름의 `(미업로드)`** 만 보고
 *    붙었다. 그래서 원고를 만들어 블로그에 다 올리셔도, 폴더 이름을 안 고치면 계속
 *    「아직 안 올림」으로 떴다.
 *
 * 🔴 고치는 방향: **폴더 이름은 프로그램이 건드리지 않는다** (전에 그렇게 정했다).
 *    대신 올렸다는 사실을 여기(`posted_at`)에 적고, 화면은 그걸 본다.
 *    폴더 이름의 `(미업로드)` 는 사장님의 대기열 표시로 그대로 남는다.
 *
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-blog-folder-posted.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE blog_folder ADD COLUMN IF NOT EXISTS posted_at timestamptz`;
    console.log("✅ blog_folder.posted_at 준비됨");

    /** 이미 「블로그에 올렸음」을 눌러 두신 원고가 있으면 그 폴더는 올린 것이다 */
    const filled = await sql`
      UPDATE blog_folder f
      SET posted_at = d.pa
      FROM (
        SELECT folder_id, MAX(COALESCE(published_at, updated_at, created_at)) AS pa
        FROM blog_draft
        WHERE status = '발행' AND folder_id IS NOT NULL
        GROUP BY folder_id
      ) d
      WHERE f.id = d.folder_id AND f.posted_at IS NULL
      RETURNING f.id`;
    console.log(`✅ 이미 올리신 폴더 ${filled.length}건에 표시를 채웠습니다`);

    const [n] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM blog_folder WHERE posted_at IS NOT NULL`;
    console.log(`   올림으로 표시된 폴더: ${n.c}건`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
