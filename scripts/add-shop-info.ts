/**
 * shop_info 표 — 견적서·거래명세서의 공급자(우리 가게) 정보 (2026-08-05)
 *   npx tsx scripts/add-shop-info.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS shop_info (
        id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        name       text NOT NULL DEFAULT '타이어모어 속초점',
        biz_no     text,
        owner      text,
        address    text,
        phone      text,
        stamp      text,  -- 도장 이미지 (data URL)
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`INSERT INTO shop_info (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
    console.log("✅ shop_info 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
