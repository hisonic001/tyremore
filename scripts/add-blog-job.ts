/**
 * 마케팅 v3 · 1단계 (2026-09-02) — 앱 버튼 → 매장 PC 다리
 *   · blog_job        — 「원고 만들기」 주문표 (mars_run 과 같은 모양)
 *   · agent_heartbeat — 대리인이 살아 있는지 (mars·blog 두 줄)
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-blog-job.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS agent_heartbeat (
        name      text PRIMARY KEY,
        last_seen timestamptz NOT NULL DEFAULT now(),
        host      text,
        version   text
      )
    `;
    console.log("✅ agent_heartbeat 준비됨");

    await sql`
      CREATE TABLE IF NOT EXISTS blog_job (
        id           bigserial PRIMARY KEY,
        kind         text NOT NULL DEFAULT '초안',
        status       text NOT NULL DEFAULT '대기',
        payload      jsonb,
        draft_ids    jsonb,
        log          text,
        error        text,
        requested_by bigint REFERENCES app_user(id),
        requested_at timestamptz NOT NULL DEFAULT now(),
        started_at   timestamptz,
        finished_at  timestamptz,
        CONSTRAINT blog_job_kind   CHECK (kind   IN ('초안','스캔','정리')),
        CONSTRAINT blog_job_status CHECK (status IN ('대기','실행중','완료','실패'))
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_blog_job_open ON blog_job (status)`;
    console.log("✅ blog_job 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
