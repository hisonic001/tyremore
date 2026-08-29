/**
 * 마케팅 1단계 (2026-08-29, docs/17-네이버-마케팅.md)
 *   · quote.referral — 결제 때 「어떻게 알고 오셨어요?」 한 칸
 *   · blog_draft     — 밤에 만들어 두는 네이버 블로그 초안
 * 코드 배포 **전에** 실행한다 — 컬럼이 없으면 판매 저장이 죽는다.
 *   npx tsx scripts/add-blog-draft.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS referral text`;
    console.log("✅ quote.referral 준비됨");

    await sql`
      CREATE TABLE IF NOT EXISTS blog_draft (
        id           bigserial PRIMARY KEY,
        quote_id     bigint REFERENCES quote(id),
        status       text NOT NULL DEFAULT '초안',
        titles       jsonb NOT NULL,
        body         text NOT NULL,
        tags         jsonb NOT NULL,
        owner_note   text,
        facts        text NOT NULL,
        warn         text,
        model        text NOT NULL,
        published_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT blog_draft_status CHECK (status IN ('초안','발행','버림'))
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_blog_draft_quote ON blog_draft (quote_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blog_draft_status ON blog_draft (status, created_at)`;
    console.log("✅ blog_draft 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
