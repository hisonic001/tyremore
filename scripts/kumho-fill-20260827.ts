/**
 * 자재 마스터에 있는데 우리 상품이 없는 것 채우기 (사장님 지적 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-fill-20260827.ts [--apply]
 *
 * 사장님: "규격 패턴 후보가 여럿이더라도 자재코드만 맞으면 상관 없는거 아닌가?"
 *
 * 맞다. 두 경우를 뭉뚱그렸던 것이 잘못이었다 —
 *   · **코드를 기존 상품에 붙일 때**: 잘못 붙이면 매입원가·기표가가 엉뚱한 상품에 간다 → 후보가
 *     여럿이면 사람이 고르는 게 맞다
 *   · **새로 만들 때**: 자재코드가 곧 그 타이어의 정체다. 비슷한 상품이 이미 있다고 해서
 *     **만들지 않을 이유가 없다** — 못 만들면 매입이 아예 막힌다
 *
 * 그래서 `resolveKumhoProduct` 를 그대로 태운다 — 후보가 하나면 잇고, 없으면 만들고,
 * 둘 이상일 때만 남긴다. 옛 스크립트(planRows)가 「애매」로 막아 둔 것들이 여기서 풀린다.
 *
 * 덤: 살아 있는 코드를 갖게 됐는데 「목록에 없음」으로 숨겨져 있던 상품은 되살린다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveKumhoProduct } from "@/lib/kumho-product";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");
  const todo = await db.execute<{ code: string; name: string; grp: string | null; st: string | null; price: number | null }>(sql`
    SELECT m.code, m.name, m.product_group grp, m.op_status st, m.price_excl price
    FROM kumho_material m
    WHERE NOT EXISTS (SELECT 1 FROM supplier_item_code s WHERE s.supplier='금호' AND s.code=m.code)
      AND NOT EXISTS (SELECT 1 FROM product p WHERE p.mars_item_no = 'KM'||m.code)
      -- 만들 기준은 이름 규칙과 같다: 유형 ④(미운영·중단)·시점 「비정상」·기표가 0원은 뺀다
      AND m.op_type IS DISTINCT FROM '④' AND m.op_status IS DISTINCT FROM '비정상' AND COALESCE(m.price_excl,0) > 0
    ORDER BY (m.product_group IN ('PCR','LTR')) DESC, m.pattern_code, m.code`);
  console.log(`상품이 없는 자재 ${todo.length}개 (승용·SUV ${todo.filter((t) => t.grp === "PCR" || t.grp === "LTR").length})\n`);

  let linked = 0, created = 0, amb = 0, fail = 0;
  const ambList: string[] = [];
  for (const t of todo) {
    if (!APPLY) {
      // 미리보기에서는 만들지 않는다 — 어느 갈래로 갈지만 본다
      const r = await resolveKumhoProduct(t.code, { learn: false });
      if (r.ok) { linked++; console.log(`  잇기  ${t.code} ${t.name.slice(0, 34)} → #${r.productId} ${r.name}`); }
      else if (r.reason === "애매함") { amb++; ambList.push(`  애매  ${t.code} ${t.name.slice(0, 34)} — ${r.message}`); }
      else { created++; }
      continue;
    }
    const r = await resolveKumhoProduct(t.code, { create: true });
    if (!r.ok) {
      if (r.reason === "애매함") { amb++; ambList.push(`  애매  ${t.code} ${t.name.slice(0, 34)} — ${r.message}`); }
      else { fail++; console.log(`  ✖ ${t.code} — ${r.message}`); }
      continue;
    }
    if (r.via === "새로 만듦") { created++; console.log(`  만듦  ${t.code} ${t.name.slice(0, 34)} → #${r.productId} "${r.name}"`); }
    else { linked++; console.log(`  잇기  ${t.code} ${t.name.slice(0, 34)} → #${r.productId} "${r.name}" (${r.via})`); }
  }
  console.log(`\n잇기 ${linked} · 새로 만듦 ${created} · 후보 여럿이라 남김 ${amb} · 실패 ${fail}`);
  if (ambList.length) { console.log("\n── 사람이 골라야 하는 것 ──"); ambList.forEach((l) => console.log(l)); }

  /* 살아 있는 코드를 갖게 됐는데 「목록에 없음」으로 숨겨져 있던 상품은 되살린다 */
  const revive = await db.execute<{ id: number; nm: string }>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm FROM product p
    WHERE p.brand_code='KM' AND NOT p.is_active AND p.hidden_reason = '금호 26.07 목록에 없음'
      AND EXISTS (SELECT 1 FROM supplier_item_code c JOIN kumho_material m ON m.code=c.code
                  WHERE c.product_id=p.id AND c.supplier='금호' AND m.op_type IS DISTINCT FROM '④')`);
  console.log(`\n숨겨져 있었는데 살아 있는 코드가 생긴 상품 ${revive.length}개 — 되살린다`);
  for (const r of revive.slice(0, 20)) console.log(`  #${r.id} ${r.nm}`);
  if (APPLY && revive.length) {
    await db.execute(sql`
      UPDATE product SET is_active = true, hidden_reason = NULL, updated_at = now()
      WHERE id IN ${sql.raw("(" + revive.map((r) => Number(r.id)).join(",") + ")")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
