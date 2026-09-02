/**
 * 마케팅 v3 · B단계 (2026-09-02) — 작업 후기 폼을 초안에 붙인다
 *
 * 「AI 가 쓴 티」의 근본은 재료 부족이었다. 왜 오셨고 뭘 봤고 왜 이걸 권했는지를
 * 사장님이 칩으로 눌러 채우면 그게 여기 남는다.
 *   npx tsx scripts/add-blog-form.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE blog_draft ADD COLUMN IF NOT EXISTS form jsonb`;
    await sql`ALTER TABLE blog_draft ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto'`;
    console.log("✅ blog_draft.form / blog_draft.source 준비됨");
    const [c] = await sql`SELECT count(*)::int n FROM blog_draft`;
    console.log(`   지금 초안 ${c.n}건 (전부 source='auto')`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
