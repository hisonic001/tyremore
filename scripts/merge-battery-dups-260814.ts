/**
 * 배터리 중복 합치기 (2026-08-14 사장님 지적 — "새로 추가를 시키면서 중복이 생긴것 같은데")
 *
 * 맞았다. 2026-08-13 에 싸군 가격표로 배터리 128종을 새로 넣었는데, MARS 이관 때 들어온
 * **델코 51종과 겹쳤다.** 겹친 것이 35쌍이고, 더 나쁜 것은 **재고가 양쪽으로 갈라진 것**이다
 * (AGM LN2 6개는 MARS 쪽, DIN74L 7개는 새 쪽 …). 이대로 두면 재고가 영원히 안 맞는다.
 *
 * 합치는 방향: **MARS 품목을 대표로 남긴다.**
 *   MARS 자동입력이 `mars_item_no` 와 `raw_name` 을 둘 다 쓴다(src/lib/mars-queue.ts:222-224).
 *   새 품목에는 그 둘이 없으므로, 새 것을 남기면 MARS 입력이 깨진다.
 *   대신 새 품목이 가진 것(품번·매입가·호환코드·분류)을 대표로 옮기고,
 *   화면에 보이는 이름만 깔끔한 쪽(display_name = '델코 DF80L')으로 바꾼다.
 *
 * 안 건드리는 것: 애매한 3쌍(아래 UNSURE)은 사장님 확인 전까지 그대로 둔다.
 *
 * 실행:
 *   npx tsx scripts/merge-battery-dups-260814.ts --dry   ← 미리보기
 *   npx tsx scripts/merge-battery-dups-260814.ts         ← 실행
 * 다시 돌려도 안전 — 이미 합쳐졌으면 할 일이 없다.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
const DRY = process.argv.includes("--dry");

/** MARS 코드(DELKOR- 뒤) → 새 품목의 품번. 이름 모양이 다른 것만 적는다 */
const ALIAS: Record<string, string> = {
  "65-900": "DF65-900",
  "75018": "DF250R(75018)",
  "75019": "DF250L(75019)",
  "AGM LN2": "LN2/60",
  "AGM LN3": "LN3/70",
  "AGM LN4": "LN4/80",
  "AGM LN5": "LN5/95",
  "AGM LN6": "LN6/105",
};

/**
 * 같은 물건인지 확신이 안 서는 것 — 손대지 않는다.
 * 잘못 합치면 재고와 이력이 엉뚱한 데로 간다. 사장님 확인 뒤에 처리한다.
 */
const UNSURE = ["67018", "67019", "DF100B"];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const mars = await sql<{ id: number; mars_item_no: string; raw_name: string }[]>`
      SELECT id, mars_item_no, raw_name FROM product
      WHERE item_type='part' AND category='40-BATTERY' AND mars_item_no LIKE 'DELKOR-%'
      ORDER BY id`;
    const news = await sql<{
      id: number; part_no: string; raw_name: string; purchase_price: number | null;
      fitment: string | null; min_qty: number | null;
    }[]>`
      SELECT id, part_no, raw_name, purchase_price, fitment, min_qty FROM product
      WHERE item_type='part' AND category='배터리' AND mars_item_no IS NULL AND part_no IS NOT NULL`;

    const byPartNo = new Map(news.map((n) => [n.part_no.toUpperCase(), n]));

    const pairs: { keep: (typeof mars)[number]; drop: (typeof news)[number] }[] = [];
    const skipped: string[] = [];

    for (const m of mars) {
      const code = m.mars_item_no.replace(/^DELKOR-/, "").trim();
      if (UNSURE.includes(code)) {
        skipped.push(`${code} — 같은 물건인지 확실치 않아 건너뜀`);
        continue;
      }
      const want = (ALIAS[code] ?? code).toUpperCase();
      const n = byPartNo.get(want);
      if (n) pairs.push({ keep: m, drop: n });
    }

    console.log(`MARS 델코 배터리 ${mars.length}종 · 새 배터리 ${news.length}종`);
    console.log(`→ 합칠 짝 ${pairs.length}쌍${skipped.length ? `, 보류 ${skipped.length}건` : ""}\n`);
    for (const s of skipped) console.log(`  ⏸ ${s}`);

    // 미리보기 — 재고가 어디에 얼마나 붙어 있는지까지
    for (const { keep, drop } of pairs) {
      const [st] = await sql<{ k: number; d: number }[]>`
        SELECT COALESCE((SELECT SUM(qty)::int FROM stock_item WHERE product_id=${keep.id} AND status='재고'),0) k,
               COALESCE((SELECT SUM(qty)::int FROM stock_item WHERE product_id=${drop.id} AND status='재고'),0) d`;
      const move = st.d > 0 ? ` · 재고 ${st.d}개 옮김` : "";
      const has = st.k > 0 ? ` (대표 재고 ${st.k}개)` : "";
      console.log(`  #${keep.id} ← #${drop.id}  ${drop.raw_name}${has}${move}`);
    }

    if (DRY) {
      console.log("\n--dry: 여기까지. 쓰기 없음");
      return;
    }

    let done = 0;
    let moved = 0;
    for (const { keep, drop } of pairs) {
      await sql.begin(async (tx) => {
        const st = await tx`UPDATE stock_item SET product_id=${keep.id} WHERE product_id=${drop.id} RETURNING 1`;
        await tx`UPDATE quote_item SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE purchase_invoice_item SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE product_barcode SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        await tx`UPDATE supplier_item_code SET product_id=${keep.id} WHERE product_id=${drop.id}`;
        /**
         * 새 품목이 가진 것을 대표로 옮긴다.
         * raw_name·mars_item_no·brand_code 는 **손대지 않는다** — MARS 입력이 쓰는 값이다.
         * 화면에 보이는 이름만 깔끔한 쪽으로 (display_name).
         */
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
        // 참조가 남아 있으면 외래키가 막아 준다 — 그게 마지막 안전장치다
        await tx`DELETE FROM product WHERE id = ${drop.id}`;
        moved += st.length;
      });
      done++;
    }

    /** 남은 MARS 배터리도 분류를 「배터리」로 맞춰 재고 화면에서 같이 관리되게 한다 */
    const rest = await sql`UPDATE product SET category='배터리', updated_at=now()
      WHERE item_type='part' AND category='40-BATTERY' RETURNING id`;

    console.log(`\n✅ ${done}쌍 합침 (재고 ${moved}줄 옮김) · 남은 MARS 배터리 ${rest.length}종 분류 정리`);
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
