import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const base = process.env.DATABASE_URL!;
  const sql = postgres(base, { max: 1, prepare: false });
  const rows = await sql`
    SELECT pid, state,
           EXTRACT(EPOCH FROM (now() - query_start))::int AS q_s,
           wait_event_type || '/' || wait_event AS wait,
           pg_blocking_pids(pid) AS bl,
           LEFT(REPLACE(query, E'\n', ' '), 100) AS q
    FROM pg_stat_activity
    WHERE datname = 'postgres' AND application_name LIKE 'Supavisor%'
      AND pid <> pg_backend_pid() AND (state <> 'idle' OR now() - query_start > interval '1 minute')
    ORDER BY query_start
  `;
  console.log(`걸린 백엔드 ${rows.length}개:`);
  for (const r of rows) {
    console.log(`pid ${r.pid} ${r.state} q=${r.q_s}s wait=${r.wait ?? "-"} bl=${JSON.stringify(r.bl)}\n   ${r.q}`);
  }
  await sql.end();

  const s2 = postgres(base.replace(":5432/", ":6543/"), { max: 1, prepare: false, connect_timeout: 12 });
  const t0 = Date.now();
  try {
    await s2`SELECT 1`;
    console.log(`6543: ✅ ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`6543: 🔴 ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await s2.end({ timeout: 3 }).catch(() => {});
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
