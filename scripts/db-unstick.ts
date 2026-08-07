/**
 * ⭐ DB 뚫기 + 자가 치유 설정 (2026-08-07 트랜잭션 풀러 마비 사건)
 *
 * 증상: 모든 화면이 「계속 로딩중」. /mars 화면 질의가 좀비(active·ClientRead)로
 * 남아 트랜잭션 풀러 자리 3개를 다 깔고 앉으면 전면 마비가 된다.
 *
 * 하는 일:
 *   ① 2분 넘게 걸려 있는 좀비 질의를 끊는다 (읽기 질의라 데이터는 안전)
 *   ② 앞으로 60초 넘는 질의는 DB 가 스스로 끊게 설정 → 재발해도 1분 안에 자가 치유
 *   ③ 6543(트랜잭션 풀러)이 다시 뚫렸는지 확인
 *
 * 실행:  npx tsx scripts/db-unstick.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const base = process.env.DATABASE_URL!;
  const sql = postgres(base, { max: 1, prepare: false });

  console.log("① 걸려 있는 좀비 질의 끊기…");
  const killed = await sql`
    SELECT pid, pg_terminate_backend(pid) AS ok,
           EXTRACT(EPOCH FROM (now() - query_start))::int AS s
    FROM pg_stat_activity
    WHERE application_name LIKE 'Supavisor%'
      AND state = 'active'
      AND now() - query_start > interval '2 minutes'
      AND pid <> pg_backend_pid()
  `;
  if (killed.length === 0) console.log("   걸린 질의 없음");
  for (const k of killed) console.log(`   pid ${k.pid} (${k.s}초 걸림) 끊음: ${k.ok}`);

  console.log("② 자가 치유 설정 (60초 넘는 질의는 DB 가 스스로 끊음)…");
  await sql`ALTER ROLE postgres SET statement_timeout = '60s'`;
  await sql`ALTER ROLE postgres SET idle_in_transaction_session_timeout = '120s'`;
  console.log("   적용됨 — 백업·복원·앱 질의는 전부 수 초면 끝나서 영향 없음");
  await sql.end();

  console.log("③ 트랜잭션 풀러(6543) 확인…");
  const s2 = postgres(base.replace(":5432/", ":6543/"), { max: 1, prepare: false, connect_timeout: 12 });
  const t0 = Date.now();
  try {
    await s2`SELECT 1`;
    console.log(`   ✅ 뚫렸습니다 (${Date.now() - t0}ms) — 이제 사이트 새로고침하면 됩니다`);
  } catch (e) {
    console.log(`   🔴 아직 막혀 있습니다: ${(e as Error).message.split("\n")[0]}`);
    console.log("   30초 뒤 이 스크립트를 한 번 더 돌려 주세요");
  } finally {
    await s2.end({ timeout: 3 }).catch(() => {});
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
