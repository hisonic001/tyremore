/**
 * quote_item.line_type 에 'use'(부품 소모) 추가 (2026-08-11)
 *
 * 사장님 확인: "정비에 쓴 부품은 판매 등록에서 함께 담는다" — 0원 소모 줄.
 * 손님 청구액·MARS 에는 안 들어가고 재고만 차감된다.
 * 실행: npx tsx scripts/add-use-line-type.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote_item DROP CONSTRAINT IF EXISTS quote_item_line_type`;
    await sql`ALTER TABLE quote_item DROP CONSTRAINT IF EXISTS quote_item_line_type_check`;
    await sql`ALTER TABLE quote_item ADD CONSTRAINT quote_item_line_type
              CHECK (line_type IN ('tire','service','custom','use'))`;
    console.log("✅ quote_item.line_type 에 'use' 허용됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
