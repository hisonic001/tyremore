/**
 * 배터리 품목 보충 (2026-08-14 사장님 지시)
 *
 * 2026년 1~8월 싸군배터리 매입 명세 8장을 훑어 품명 31종을 뽑고 기존 128종과 대조했더니,
 * **에너자이저90R 하나만** 없었다. 나머지 30종은 품명·단가(공급가)가 전부 일치 —
 * 2025-06-14 가격표가 아직 그대로다.
 *
 * 단가는 명세서 기준 **VAT 미포함 공급가**(다른 배터리와 같은 기준).
 * 실행: npx tsx scripts/add-battery-260814.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

/** [품번, 표시이름, 공급가(VAT 별도)] */
const NEW_BATTERIES: [string, string, number][] = [
  ["에너자이저90R", "에너자이저 90R", 75500],
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    for (const [partNo, name, price] of NEW_BATTERIES) {
      const [dup] = await sql<{ id: number }[]>`
        SELECT id FROM product WHERE item_type='part' AND part_no = ${partNo} LIMIT 1`;
      if (dup) {
        await sql`UPDATE product SET purchase_price = ${price}, updated_at = now() WHERE id = ${dup.id}`;
        console.log(`이미 있음 → 단가만 갱신: ${partNo} ${price.toLocaleString()}원`);
        continue;
      }
      await sql`INSERT INTO product
          (item_type, is_serialized, raw_name, part_no, fitment, category, purchase_price, supplier_code)
        VALUES ('part', false, ${name}, ${partNo}, ${"에너자이저 배터리 일반 · 매입가 VAT별도"},
                '배터리', ${price}, '싸군배터리')`;
      console.log(`✅ 새로 등록: ${name} (${partNo}) ${price.toLocaleString()}원`);
    }

    const [c] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM product WHERE item_type='part' AND category='배터리'`;
    console.log(`배터리 품목 총 ${c.n}종`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
