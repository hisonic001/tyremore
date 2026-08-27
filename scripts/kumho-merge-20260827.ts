/**
 * 금호 쌍둥이 품목 합치기 (사장님 확인 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-merge-20260827.ts [--apply]
 *
 * 사장님이 자재코드를 짚어 주시니 쌍둥이가 드러났다. 기존 「중복 상품 합치기」 도구를 그대로 쓴다 —
 * 재고·판매·매입·사전을 대표 품목으로 옮기고 흡수된 행은 지운다(이력은 하나도 안 잃는다).
 *
 * 🔴 #43828 의 2본은 사장님이 「없애고 4본으로」 하라고 하셨다 — 8/7 에 만들어진 DOT 없는 줄이다.
 *    줄을 지우지 않고 **'폐기'로 표시**해 흔적을 남긴 뒤 합친다. 결과 재고는 4본.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mergeProducts } from "@/lib/product-merge";

const APPLY = process.argv.includes("--apply");

const PLAN: { keep: number; absorb: number; what: string }[] = [
  { keep: 8946, absorb: 1294, what: "SuperMile TX31 215/55R17 (자재 2413032)" },
  { keep: 8885, absorb: 43887, what: "Solus TA21 195/65R15 (자재 2375102)" },
  { keep: 44094, absorb: 8836, what: "Solus Advance TA51+ 195/45R16 (자재 2387942)" },
  { keep: 8863, absorb: 43828, what: "SOLUS ADVANCE TA51+ 245/45R18 (자재 2387832)" },
  { keep: 1300, absorb: 44085, what: "KC55 Portran 145/80R13 12겹 (자재 2420172)" },
];

async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");
  const before = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`);
  console.log(`전체 재고 ${before[0].n}본`);

  for (const g of PLAN) {
    const rows = await db.execute<{ id: number; nm: string | null; stock: number; sold: number; mars: string | null }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) nm, p.mars_item_no mars,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
             (SELECT count(*)::int FROM quote_item q WHERE q.product_id=p.id) sold
      FROM product p WHERE p.id IN (${g.keep}, ${g.absorb})`);
    const k = rows.find((r) => Number(r.id) === g.keep);
    const a = rows.find((r) => Number(r.id) === g.absorb);
    if (!k || !a) { console.log(`\n${g.what} — 이미 합쳐졌거나 없음 (건너뜀)`); continue; }
    console.log(`\n${g.what}`);
    console.log(`   남길 #${k.id} ${k.nm} 재고 ${k.stock}·판매 ${k.sold} ← 흡수 #${a.id} ${a.nm} 재고 ${a.stock}·판매 ${a.sold}`);

    if (g.absorb === 43828) {
      console.log(`   🔴 #43828 의 2본은 '폐기'로 표시한 뒤 합칩니다 (사장님: 합쳐서 4본으로)`);
      // stock_item 에는 메모 칸이 없다 — 상태만 바꾼다. 어느 줄이었는지는 이 스크립트가 기록이다
      if (APPLY) await db.execute(sql`
        UPDATE stock_item SET status='폐기' WHERE product_id = 43828 AND status = '재고'`);
    }
    if (!APPLY) continue;
    const r = await mergeProducts(g.keep, [g.absorb]);
    console.log(r.ok ? `   ✔ ${r.moved}` : `   ✖ ${r.error}`);
  }

  /* 합친 뒤 대표 품목의 세부사항 바로잡기 */
  if (APPLY) {
    // 195/45R16 은 84V 가 맞다 (사장님 확인) — 97V 는 잘못 들어간 값
    await db.execute(sql`UPDATE product SET load_index='84', updated_at=now() WHERE id=44094 AND load_index='97'`);
    // #1300 을 12겹 값으로 (이름·하중속도·기표가) — 흡수된 #44085 쪽이 정확했다
    await db.execute(sql`
      UPDATE product SET display_name='KC55 Portran 12P', load_index='94', speed_rating='R',
             list_price_excl=88000, list_price=96800, updated_at=now()
      WHERE id=1300`);
    console.log("\n#44094 하중지수 84 로 · #1300 을 12겹(94R · 96,800원)으로 정리");
  }

  const after = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`);
  console.log(`\n전체 재고 ${before[0].n} → ${after[0].n}본 (차이 ${after[0].n - before[0].n} — #43828 폐기 2본만큼 줄어야 정상)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
