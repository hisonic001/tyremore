/**
 * quote.tyre_positions 열 추가 (2026-08-05) — 어느 바퀴를 갈았는지.
 * 판매 등록의 체크박스로 받아 MARS 점검표의 타이어 교체 표시에 쓴다.
 *   npx tsx scripts/add-tyre-positions.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS tyre_positions text`;
    console.log("✅ quote.tyre_positions 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
