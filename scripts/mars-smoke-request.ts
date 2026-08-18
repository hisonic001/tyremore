/**
 * ⭐ 아침 자가점검 요청 넣기 (2026-08-10 — 자동입력 개선 전략)
 *
 * 작업 스케줄러가 아침마다 이걸 돌리면 mars_run 에 「자가점검·대기」 요청이 남고,
 * 켜져 있는 대리인(mars-agent)이 mars-fill --smoke 를 돌린다.
 * 실행: npx tsx scripts/mars-smoke-request.ts   (mars-smoke.bat 가 이걸 부른다)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // 이미 대기·실행중인 자가점검이 있으면 또 넣지 않는다
    const [dup] = await sql`
      SELECT id FROM mars_run WHERE kind = '자가점검' AND status IN ('대기', '실행중') LIMIT 1
    `;
    if (dup) {
      console.log(`이미 자가점검 요청이 있습니다 (#${dup.id}) — 새로 넣지 않습니다`);
      return;
    }
    const [r] = await sql`
      INSERT INTO mars_run (kind, status) VALUES ('자가점검', '대기') RETURNING id
    `;
    console.log(`✅ 자가점검 요청 #${r.id} — 대리인이 곧 실행합니다 (결과는 정비 내역 배너·mars_run 로그)`);
    /**
     * ⭐ 아침 대사도 같이 (2026-08-18 단계3, 사장님 승인 「매일 자동」) —
     *    자가점검이 끝나면 대리인이 이어서 돌린다. 스케줄러는 재설정 불필요.
     */
    const [dup2] = await sql`
      SELECT id FROM mars_run WHERE kind = '대사' AND status IN ('대기', '실행중') LIMIT 1
    `;
    if (!dup2) {
      const [r2] = await sql`
        INSERT INTO mars_run (kind, status) VALUES ('대사', '대기') RETURNING id
      `;
      console.log(`✅ 기록 맞추기(대사) 요청 #${r2.id} — 자가점검에 이어 실행됩니다`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
