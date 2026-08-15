/**
 * 옛 MARS 부품 숨기기 + 델코 대형 배터리 2쌍 합치기 (2026-08-15 사장님 지시)
 *
 * ① "숨겨줘" — MARS 이관 때 들어온 이름뿐인 부품(MANN 에어필터 ×46 같은 것).
 *    품번·가격·적용차종·재고·판매가 전부 없어 검색 노이즈만 된다.
 *    지우지 않고 끈다(is_active=false) — 되살리면 그대로 돌아온다.
 *    ⚠️ 재고·판매·매입이 하나라도 걸린 것은 건너뛴다 (없어야 정상이지만 안전장치).
 *
 * ② 사장님 확인: 델코 67019 = DF170L, 67018 = DF170R.
 *    merge-battery-dups-260814.ts 와 같은 방식 — MARS 품목을 대표로 남기고
 *    새 품목의 품번·매입가·호환코드를 옮긴 뒤 흡수한다.
 *    (DF100B ↔ DF100BR 은 아직 미확인 — 그대로 둔다)
 *
 * 실행: npx tsx scripts/hide-legacy-parts-260815.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const MERGES: [marsNo: string, newPartNo: string][] = [
  ["DELKOR-67019", "DF170L"],
  ["DELKOR-67018", "DF170R"],
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // ── ① 옛 MARS 부품 숨기기
    const hidden = await sql`
      UPDATE product p SET is_active = false, hidden_reason = 'manual', updated_at = now()
      WHERE p.item_type = 'part'
        AND p.category IN ('00-MANUFACTURER','50-LUBES','60-PARTS','55-BRAKES','70-ACCESS','80-MISC')
        AND p.is_active
        AND NOT EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id = p.id AND s.qty <> 0)
        AND NOT EXISTS (SELECT 1 FROM quote_item qi WHERE qi.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_invoice_item ii WHERE ii.product_id = p.id)
      RETURNING p.id`;
    console.log(`① 옛 MARS 부품 ${hidden.length}종 숨김`);

    const [left] = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM product
      WHERE item_type='part' AND is_active
        AND category IN ('00-MANUFACTURER','50-LUBES','60-PARTS','55-BRAKES','70-ACCESS','80-MISC')`;
    if (left.n > 0) console.log(`   ⚠️ 이력이 걸려 있어 못 숨긴 것 ${left.n}종 — 확인 필요`);

    // ── ② 델코 67019·67018 합치기
    for (const [marsNo, partNo] of MERGES) {
      const [keep] = await sql<{ id: number }[]>`
        SELECT id FROM product WHERE mars_item_no = ${marsNo} LIMIT 1`;
      const [drop] = await sql<{
        id: number; part_no: string; raw_name: string; purchase_price: number | null;
        fitment: string | null; min_qty: number | null;
      }[]>`
        SELECT id, part_no, raw_name, purchase_price, fitment, min_qty FROM product
        WHERE item_type='part' AND part_no = ${partNo} AND mars_item_no IS NULL LIMIT 1`;
      if (!keep || !drop) {
        console.log(`② ${marsNo} ← ${partNo}: 이미 합쳐졌거나 없음 — 건너뜀`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx`UPDATE stock_item SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE quote_item SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE purchase_invoice_item SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE product_barcode SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE supplier_item_code SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE product SET
            part_no = ${drop.part_no},
            purchase_price = COALESCE(${drop.purchase_price}, purchase_price),
            fitment = COALESCE(${drop.fitment}, fitment),
            min_qty = COALESCE(${drop.min_qty}, min_qty),
            display_name = ${drop.raw_name},
            category = '배터리',
            is_active = true,
            updated_at = now()
          WHERE id = ${keep.id}`;
        await tx`DELETE FROM product WHERE id = ${drop.id}`;
      });
      console.log(`② #${keep.id} ← #${drop.id} (${partNo}) 합침`);
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
