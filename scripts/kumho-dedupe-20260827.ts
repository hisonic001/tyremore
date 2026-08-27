/**
 * 금호 쌍둥이 품목 정리 — 안전한 것만 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-dedupe-20260827.ts [--apply]
 *
 * 자재코드 사전이 채워지자 같은 타이어가 두세 상품으로 갈라져 있는 것이 드러났다.
 * 그런데 **규격+패턴이 같다고 같은 물건은 아니다** — 겹수(10겹/12겹)·구조(XL/C)·하중속도가
 * 다르면 다른 타이어다. 실제로 145/80R13 KC55 는 10겹(#8495)과 12겹(#1300)이 따로 있고,
 * 215/65R17 KC53 도 TXLL 과 C 6겹이 따로다.
 *
 * 그래서 **하중지수·속도기호가 정확히 같고, 흡수되는 쪽이 재고 0 · 판매 0** 인 것만 합친다.
 * 나머지는 목록만 뽑아 사장님이 보신다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mergeProducts } from "@/lib/product-merge";

const APPLY = process.argv.includes("--apply");

interface P { [k: string]: unknown; id: number; nm: string | null; w: number; ar: number | null; rim: string; li: string | null; ss: string | null; stock: number; sold: number; act: boolean; codes: string | null; mars: string | null }

const PAT = /\b(TA9[12]|TA51|TA31|TA21|HP7[12]|HP51|AT5[12]|KL7[13]|KL33|MT71|HA32|MC55|KC55|KC53|KC12|PA71|PS7[12]|WS71|WP72|KW17|CW51|CW11|TX31|VX51|KRA50|RA50|VA91)\b/;

async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");
  const before = (await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`))[0].n;

  const ps = await db.execute<P>(sql`
    SELECT p.id, COALESCE(p.display_name, p.pattern) nm, p.width w, p.aspect_ratio ar, p.rim_inch::text rim,
           p.load_index li, p.speed_rating ss, p.is_active act, p.mars_item_no mars,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT count(*)::int FROM quote_item q WHERE q.product_id=p.id) sold,
           (SELECT string_agg(c.code, ',' ORDER BY c.code) FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호') codes
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire' AND p.width IS NOT NULL`);

  const patOf = (p: P) => `${p.nm ?? ""} ${p.mars ?? ""}`.toUpperCase().match(PAT)?.[1] ?? "";
  const g = new Map<string, P[]>();
  for (const p of ps) {
    const q = patOf(p);
    if (!q) continue;
    // 🔴 하중지수·속도기호까지 열쇠에 넣는다 — 겹수·구조가 다른 타이어를 섞지 않기 위해
    const k = `${p.w}/${p.ar ?? "-"}R${Number(p.rim)} ${q} ${p.li ?? "?"}${(p.ss ?? "?").toUpperCase()}`;
    g.set(k, [...(g.get(k) ?? []), p]);
  }

  const safe: { keep: P; absorb: P[]; k: string }[] = [];
  const review: { k: string; v: P[] }[] = [];
  for (const [k, v] of g) {
    if (v.length < 2) continue;
    if (k.includes("?")) { review.push({ k, v }); continue; } // 하중속도가 비면 판단 보류
    const empty = v.filter((p) => p.stock === 0 && p.sold === 0);
    const rest = v.filter((p) => p.stock > 0 || p.sold > 0);
    if (rest.length === 1 && empty.length > 0) safe.push({ keep: rest[0], absorb: empty, k });
    else if (rest.length === 0 && empty.length > 1) {
      // 전부 빈 것 — 코드가 붙은 쪽(또는 첫 번째)을 남긴다
      const keep = empty.find((p) => p.codes) ?? empty[0];
      safe.push({ keep, absorb: empty.filter((p) => p.id !== keep.id), k });
    } else review.push({ k, v });
  }

  console.log(`\n안전하게 합칠 묶음 ${safe.length} (없앨 빈 품목 ${safe.reduce((a, s) => a + s.absorb.length, 0)})`);
  console.log(`사장님이 봐야 할 묶음 ${review.length}\n`);

  let ok = 0, fail = 0;
  for (const s of safe) {
    const line = `  ${s.k}: 남길 #${s.keep.id}(재고${s.keep.stock}·판매${s.keep.sold}) ← ${s.absorb.map((p) => `#${p.id}`).join(",")}`;
    if (!APPLY) { console.log(line); continue; }
    const r = await mergeProducts(Number(s.keep.id), s.absorb.map((p) => Number(p.id)));
    if (r.ok) { ok++; console.log(`${line} ✔`); } else { fail++; console.log(`${line} ✖ ${r.error}`); }
  }

  console.log(`\n── 사장님이 봐야 할 ${review.length}묶음 (겹수·구조·하중속도가 달라 자동으로 못 합침) ──`);
  for (const r of review.sort((a, b) => b.v.reduce((s, p) => s + p.stock, 0) - a.v.reduce((s, p) => s + p.stock, 0)).slice(0, 30))
    console.log(`  ${r.k}: ${r.v.map((p) => `#${p.id} ${p.li ?? "?"}${p.ss ?? "?"} 재고${p.stock} 판매${p.sold} ${p.codes ?? "코드없음"}${p.act ? "" : " 숨김"}`).join("  |  ")}`);

  const after = (await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM stock_item WHERE status='재고'`))[0].n;
  console.log(`\n합침 ${ok} · 실패 ${fail} · 전체 재고 ${before} → ${after}본 (바뀌면 안 된다)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
