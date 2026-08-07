import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const base = process.env.DATABASE_URL!;
  const sql = postgres(base, { max: 1, prepare: false });

  const rows = await sql`
    SELECT pid, state,
           EXTRACT(EPOCH FROM (now() - query_start))::int AS q_s,
           EXTRACT(EPOCH FROM (now() - xact_start))::int AS x_s,
           wait_event_type || '/' || wait_event AS wait,
           pg_blocking_pids(pid) AS blocked_by,
           LEFT(REPLACE(query, E'\n', ' '), 80) AS q
    FROM pg_stat_activity
    WHERE datname = 'postgres' AND application_name LIKE 'Supavisor%'
      AND pid <> pg_backend_pid()
      AND (state <> 'idle' OR now() - query_start > interval '2 minutes')
    ORDER BY query_start
  `;
  console.log(`눈여겨볼 백엔드 ${rows.length}개:`);
  for (const r of rows) {
    console.log(
      `pid ${r.pid} ${r.state} q=${r.q_s}s xact=${r.x_s ?? "-"}s wait=${r.wait ?? "-"} blockedBy=${JSON.stringify(r.blocked_by)} :: ${r.q}`,
    );
  }

  const [cnt] = await sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname='postgres' AND application_name LIKE 'Supavisor%'
  `;
  console.log(`Supavisor 백엔드 총 ${cnt.n}개`);
  await sql.end();

  const url6543 = base.replace(":5432/", ":6543/");
  const t0 = Date.now();
  const s2 = postgres(url6543, { max: 1, prepare: false, connect_timeout: 12 });
  try {
    await s2`SELECT 1`;
    console.log(`6543: ✅ ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`6543: 🔴 ${(e as Error).message.split("\n")[0]} (${Date.now() - t0}ms)`);
  } finally {
    await s2.end({ timeout: 3 }).catch(() => {});
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
