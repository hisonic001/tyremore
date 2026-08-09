/**
 * 일회성 (2026-08-09) — MARS 흐름 전환의 뒷정리.
 *
 * 판매 등록이 자동으로 '미전송'(=대기열)에 올리던 것을 '보류'(안 올림)로 바꿨다.
 * 이미 '미전송' 으로 남아 있던 판매들을 '보류' 로 돌려, 사장님이 정비 내역에서
 * **직접 체크한 것만** 올라가게 한다. 실행: npx tsx scripts/mars-backlog-to-hold.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{ id: number; quote_no: string }[]>`
      UPDATE quote SET mars_status = '보류', updated_at = now()
      WHERE mars_status = '미전송'
      RETURNING id, quote_no
    `;
    console.log(`✅ 미전송 → 보류 ${rows.length}건 전환`);
    for (const r of rows) console.log(`  ${r.quote_no}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
