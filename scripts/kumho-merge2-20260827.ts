/**
 * 금호 쌍둥이 합치기 2차 — 사장님 확인분 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-merge2-20260827.ts [--apply]
 *
 * 사장님 지시
 *   ① #44089 ↔ #8864 (TA51 245/45R19 102W) — 합치고 **신코드**로
 *   ② #44083 ↔ #8603 (TA91 225/45R18 95W) — 합치고 **신코드**로
 *   ③ 195/70R15 KC53 은 **전부 8겹뿐** — 세 갈래를 하나로
 *   ④ 215/65R17 은 **4겹 3본 · 6겹(스타리아 OE) 4본** — 서로 다른 물건이니 합치지 않는다
 *
 * 합치기는 남는 쪽으로 코드를 다 모으므로, 재고·판매가 많은 쪽을 남기고 신코드가 거기 붙게 한다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mergeProducts } from "@/lib/product-merge";

const APPLY = process.argv.includes("--apply");

const PLAN: { keep: number; absorb: number[]; what: string; newCode: string; name?: string; li?: string; ss?: string }[] = [
  { keep: 44089, absorb: [8864], what: "Solus Advance TA51+ 245/45R19 102W", newCode: "2387382" },
  { keep: 44083, absorb: [8603], what: "Majesty 9 Solus EDGE TA91+ 225/45R18 95W", newCode: "2420522" },
  { keep: 45584, absorb: [8387, 8418], what: "KC53 Portran 195/70R15 8겹", newCode: "2206152", name: "KC53 Portran 8P" },
];

async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");
  const before = (await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`))[0].n;

  for (const g of PLAN) {
    const rows = await db.execute<{ id: number; nm: string | null; stock: number; sold: number; codes: string | null }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) nm,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
             (SELECT count(*)::int FROM quote_item q WHERE q.product_id=p.id) sold,
             (SELECT string_agg(c.code, ',' ORDER BY c.code) FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호') codes
      FROM product p WHERE p.id IN ${sql.raw("(" + [g.keep, ...g.absorb].join(",") + ")")} ORDER BY p.id`);
    console.log(`\n${g.what} — 신코드 ${g.newCode}`);
    for (const r of rows) console.log(`   #${r.id} ${r.nm} 재고${r.stock} 판매${r.sold} ${r.codes ?? "코드없음"}${Number(r.id) === g.keep ? "  ← 남길 것" : ""}`);
    if (!APPLY) continue;
    const r = await mergeProducts(g.keep, g.absorb);
    console.log(r.ok ? `   ✔ ${r.moved}` : `   ✖ ${r.error}`);
    if (!r.ok) continue;
    // 신코드가 남은 품목에 확실히 붙어 있게 (합치기가 옮겨 주지만 없던 경우 대비)
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
      VALUES ('금호', ${g.newCode}, ${g.keep}, ${g.what}, '사장님확인', now(), now())
      ON CONFLICT (supplier, code) DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = now()`);
    if (g.name) await db.execute(sql`UPDATE product SET display_name = ${g.name}, updated_at = now() WHERE id = ${g.keep}`);
  }

  /* ④ 215/65R17 — 사장님 확인: 4겹과 6겹(스타리아 OE)은 다른 물건. 이름만 분명하게 */
  console.log("\n215/65R17 KC53 — 합치지 않음 (4겹 · 6겹 스타리아 OE 는 다른 물건)");
  if (APPLY) {
    await db.execute(sql`UPDATE product SET display_name = 'KC53 Portran 4P', updated_at = now() WHERE id = 8693`);
    await db.execute(sql`UPDATE product SET display_name = 'KC53 Portran 6P 스타리아 OE', updated_at = now() WHERE id = 8806`);
  }
  const chk = await db.execute<{ id: number; nm: string | null; stock: number; codes: string | null }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT string_agg(c.code, ',') FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호') codes
    FROM product p WHERE p.id IN (8693, 8806) ORDER BY p.id`);
  for (const r of chk) console.log(`   #${r.id} ${r.nm} 재고${r.stock} ${r.codes ?? "코드없음"}`);

  const after = (await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`))[0].n;
  console.log(`\n전체 재고 ${before} → ${after}본 (바뀌면 안 된다)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
