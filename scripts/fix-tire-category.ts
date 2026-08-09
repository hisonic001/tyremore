/**
 * 일회성 (2026-08-09) — 타이어인데 category 가 비어 있던 상품 보정.
 *
 * 사장님 버그 제보: "새로 등록한 상품들은 타이어 검색시 할인율이 25%로 적용되지 않는 점."
 * 기본 판매 할인율 25% 규칙은 price_rule 의 category='10-TIRES' 에 걸려 있는데,
 * 손 등록(stock.ts)과 금호 상품목록 업로드(kumho-sheet.ts)가 category 를 안 넣고 있었다.
 * 생성 경로는 고쳤고, 이미 비어 있는 타이어들을 여기서 채운다.
 * 실행: npx tsx scripts/fix-tire-category.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{ id: number; display_name: string | null }[]>`
      UPDATE product SET category = '10-TIRES', updated_at = now()
      WHERE item_type = 'tire' AND category IS NULL
      RETURNING id, display_name
    `;
    console.log(`✅ 타이어 category 보정 ${rows.length}건`);
    for (const r of rows.slice(0, 20)) console.log(`  #${r.id} ${r.display_name ?? ""}`);
    if (rows.length > 20) console.log(`  … 외 ${rows.length - 20}건`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
