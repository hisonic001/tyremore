/**
 * 마케팅 v3 · C단계 (2026-09-02) — 사장님 사진 폴더
 *   · blog_folder — 시공 건별 폴더 (「(미업로드)」가 실제 대기열)
 *   · blog_photo  — 사진 한 장. **원본은 안 온다. 160px 썸네일만.**
 *   · blog_draft.photo_plan — 어느 사진을 몇 번 자리에 넣을지
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-blog-photo.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS blog_folder (
        id            bigserial PRIMARY KEY,
        name          text NOT NULL UNIQUE,
        label         text NOT NULL,
        plate         text,
        is_pending    boolean NOT NULL DEFAULT false,
        photo_count   integer NOT NULL DEFAULT 0,
        video_count   integer NOT NULL DEFAULT 0,
        offline_count integer NOT NULL DEFAULT 0,
        folder_mtime  timestamptz,
        vehicle_id    bigint REFERENCES vehicle(id),
        quote_id      bigint REFERENCES quote(id),
        is_gone       boolean NOT NULL DEFAULT false,
        scanned_at    timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_blog_folder_pending ON blog_folder (is_pending, folder_mtime)`;
    console.log("✅ blog_folder 준비됨");

    await sql`
      CREATE TABLE IF NOT EXISTS blog_photo (
        id         bigserial PRIMARY KEY,
        folder_id  bigint NOT NULL REFERENCES blog_folder(id) ON DELETE CASCADE,
        file_name  text NOT NULL,
        byte_size  integer NOT NULL DEFAULT 0,
        is_offline boolean NOT NULL DEFAULT false,
        is_video   boolean NOT NULL DEFAULT false,
        taken_at   timestamptz,
        thumb      text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_photo ON blog_photo (folder_id, file_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blog_photo_folder ON blog_photo (folder_id)`;
    console.log("✅ blog_photo 준비됨");

    await sql`ALTER TABLE blog_draft ADD COLUMN IF NOT EXISTS folder_id bigint REFERENCES blog_folder(id)`;
    await sql`ALTER TABLE blog_draft ADD COLUMN IF NOT EXISTS photo_plan jsonb`;
    console.log("✅ blog_draft.folder_id / photo_plan 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
