/**
 * 자동 수집 받은 편지함 최근 기록 보기 (읽기 전용, D-41)
 *
 *   npx tsx scripts/intake-status.ts        최근 30건
 *   npx tsx scripts/intake-status.ts 100    최근 100건
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const n = Math.min(500, Math.max(1, Number(process.argv[2] ?? 30)));
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<{ t: string; kind: string; status: string; what: string | null; result: string | null }[]>`
      SELECT to_char(received_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS t, kind, status,
             COALESCE(file_name, subject, left(body, 40)) what, result
      FROM intake_log ORDER BY id DESC LIMIT ${n}`;
    for (const r of rows) console.log(`${r.t}  ${r.kind.padEnd(4)}  ${r.status.padEnd(4)}  ${r.what ?? ""}\n             → ${r.result ?? ""}`);
    const sum = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int n FROM intake_log WHERE received_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`;
    console.log(`\n최근 7일: ${sum.map((s) => `${s.status} ${s.n}`).join(" · ") || "없음"}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
