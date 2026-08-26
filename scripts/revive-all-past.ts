/**
 * 과거분 전량 되살리기 (사장님 방침 2026-08-26)
 *
 *   "앱과 연결은 선택이고 중요한 건 자료들 — 이전 내용 전부 다시 살려줘."
 *   「과거분」으로 접어 뒀던 계산서 636건(11.9억)을 확인 목록으로 되돌린다.
 *   통장도 2025-01부터 있으므로 전 기간 돈 확인이 가능하다.
 *   (경비·무시·수정상쇄로 정리한 것은 사용자의 판단 — 그대로 둔다)
 *
 *   npx tsx scripts/revive-all-past.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql`
      UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL
      WHERE is_active AND recon_status = '무시' AND recon_reason = '과거분'
      RETURNING id`;
    console.log(`✅ 과거분 ${rows.length}건을 되살렸습니다 — 각 달의 돈 확인·계산서 정리에 나옵니다`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
