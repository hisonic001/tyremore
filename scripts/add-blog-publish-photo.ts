/**
 * 블로그 **발행용 사진** (2026-09-05) — 사장님 지적에서 나온 것
 *
 * 화면 「사진 순서」에서 사진을 끌어다 네이버 글쓰기에 붙이면 화질이 나빴다.
 * 거기 걸린 그림이 **목록용 160px 미리보기**였기 때문이다. 브라우저는 끌 때
 * 화면에 보이는 크기가 아니라 **그림 파일 자체**를 넘긴다.
 *
 * 그래서 발행용으로 **1280px 한 벌**을 따로 둔다 (`blog_photo.publish`).
 * 🔴 원본(2.7MB)을 넣지 않는 이유: 네이버가 어차피 본문 폭 966px 로 줄인다.
 *    1280px 250KB 나 원본이나 독자 눈에는 같고, 창고만 10배 든다.
 *
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-blog-publish-photo.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE blog_photo ADD COLUMN IF NOT EXISTS publish text`;
    console.log("✅ blog_photo.publish 준비됨");

    /**
     * 대리인 주문 종류에 「발행사진」을 더한다.
     * 🔴 **기존 것을 빠뜨리면 안 된다.** 제약을 통째로 다시 만드는 방식이라,
     *    `add-vehicle-spec.ts` 가 넣어 둔 '제원' 을 여기서 빠뜨리면 조용히 사라진다.
     *    (실제로 한 번 빠뜨렸다 — 2026-09-05.)
     */
    await sql`ALTER TABLE blog_job DROP CONSTRAINT IF EXISTS blog_job_kind`;
    await sql`
      ALTER TABLE blog_job ADD CONSTRAINT blog_job_kind
        CHECK (kind IN ('초안','스캔','정리','제원','발행사진'))`;
    console.log("✅ blog_job 주문 종류에 「발행사진」 추가됨");

    const [n] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM blog_photo WHERE publish IS NOT NULL`;
    console.log(`   지금 발행용 사진이 있는 것: ${n.c}장`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
