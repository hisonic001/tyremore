/**
 * quote_item.memo 열 추가 (2026-08-07) — 품목 줄마다 메모 한 줄.
 * 판매 등록에서 줄별로 받아, MARS 자동 입력이 **그 줄의 「설명 2」**에 넣는다.
 * (전에는 판매 전체 메모 하나를 첫 줄 설명 2 에 넣었다 — 사장님 수정 지시)
 *   npx tsx scripts/add-line-memo.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`ALTER TABLE quote_item ADD COLUMN IF NOT EXISTS memo text`;
    console.log("✅ quote_item.memo 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
