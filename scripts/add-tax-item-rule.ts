/**
 * 세금계산서 품목 단위 규칙 (사장님 제보 2026-08-25)
 *
 *   미쉐린처럼 한 상대가 「타이어 매입」과 「digital module 수수료」를 섞어 보낸다 —
 *   상대 전체가 아니라 (상대 사업자번호 + 품목명) 조합으로 경비를 기억한다.
 *
 *   npx tsx scripts/add-tax-item-rule.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS tax_item_rule (
        id         bigserial PRIMARY KEY,
        biz_no     text NOT NULL,
        item_key   text NOT NULL,          -- 품목명 정규화 (normName 규칙)
        item_raw   text NOT NULL,
        kind       text NOT NULL CHECK (kind IN ('경비','무시')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (biz_no, item_key)
      )`;
    console.log("✅ tax_item_rule 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
