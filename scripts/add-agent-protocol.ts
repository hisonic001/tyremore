/**
 * 대리인 판 번호 자리 (2026-09-05)
 *
 * 🔴 왜 필요한가: 대리인은 켜 둔 창에서 계속 도는 프로그램이라 **다시 켜기 전까지
 *    옛 코드로 돈다.** 그런데 옛 대리인이 모르는 주문을 **조용히 원고 만들기로
 *    흘려보내서**, 「사진 고화질로 준비」가 원고 4건을 만들고 「사진으로 읽기」는
 *    아무 일도 안 일어나는 일이 실제로 났다.
 *    이제 대리인이 자기 판 번호를 알리고, 앱이 낮으면 단추를 잠근다.
 *
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-agent-protocol.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE agent_heartbeat ADD COLUMN IF NOT EXISTS protocol integer NOT NULL DEFAULT 0`;
    console.log("✅ agent_heartbeat.protocol 준비됨 (아직 안 알린 대리인은 0)");

    const rows = await sql<{ name: string; host: string; protocol: number }[]>`
      SELECT name, host, protocol FROM agent_heartbeat ORDER BY name`;
    for (const r of rows) console.log(`   ${r.name} @ ${r.host} — 판 ${r.protocol}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
