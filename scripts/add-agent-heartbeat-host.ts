/**
 * 마케팅 v3 · A단계 (2026-09-02) — 대리인 「살아있음」 표시를 컴퓨터별로
 *
 * 사장님이 매장 컴퓨터 **두 대**를 클라우드로 묶어 쓰신다. 열쇠가 name 하나뿐이면
 * 두 대가 서로 덮어써서 어느 쪽이 켜져 있는지 알 수 없다. (name, host) 로 바꾼다.
 * 이미 있던 행은 host 가 비어 있을 수 있어 '?' 로 채운 뒤 열쇠를 바꾼다.
 *   npx tsx scripts/add-agent-heartbeat-host.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`UPDATE agent_heartbeat SET host = '?' WHERE host IS NULL`;
    await sql`ALTER TABLE agent_heartbeat ALTER COLUMN host SET DEFAULT '?'`;
    await sql`ALTER TABLE agent_heartbeat ALTER COLUMN host SET NOT NULL`;
    await sql`ALTER TABLE agent_heartbeat DROP CONSTRAINT IF EXISTS agent_heartbeat_pkey`;
    await sql`ALTER TABLE agent_heartbeat ADD PRIMARY KEY (name, host)`;
    console.log("✅ agent_heartbeat 열쇠를 (name, host) 로 바꿈");
    const rows = await sql`SELECT name, host, version FROM agent_heartbeat ORDER BY 1,2`;
    console.log("   지금 기록:", rows.length ? JSON.stringify(rows) : "(없음)");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
