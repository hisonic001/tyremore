/**
 * 별명 오학습 정리 (8월 감사 C11, 2026-08-25)
 *
 *   확정 과정에서 잘못 배운 별명 2건을 지운다 — 화면에 엉뚱한 제안으로 실출현:
 *     딜러타이어 → S:블랙서클   (딜러타이어 출금에 블랙서클 지급 제안)
 *     엠에프티코리아 → S:나이스 오토파츠 (엠에프티 계산서에 나이스 후보)
 *   ※ 맥스런 → S:타이어핑 은 사장님이 확인한 실제 매핑 — 유지.
 *
 *   npx tsx scripts/fix-alias-20260825.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const a = await sql`
      DELETE FROM party_alias
      WHERE party_key = 'S:블랙서클' AND alias_key LIKE '%딜러타이어%'
      RETURNING alias_key`;
    const b = await sql`
      DELETE FROM party_alias
      WHERE party_key = 'S:나이스 오토파츠' AND alias_key LIKE '%엠에프티%'
      RETURNING alias_key`;
    console.log(`✅ 오학습 별명 삭제: 딜러타이어→블랙서클 ${a.length}건 · 엠에프티→나이스 ${b.length}건`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
