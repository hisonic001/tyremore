/**
 * 금호 품목 DB 건강 검사 — 기표가 Master 기준 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-health-20260827.ts
 *
 * "가장 정확한 기표가 엑셀을 따라가야함" — 그 기준으로 지금 어디가 비어 있는지 한 장에 본다.
 * 고치는 스크립트가 아니라 **재는** 스크립트다. 다시 돌리면 나아졌는지 바로 보인다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PICK_MATERIAL_ORDER } from "@/lib/kumho-product";

const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) => db.execute<T>(s);

async function main() {
  const [m] = await q<{ n: number; owner: number; pats: number }>(sql`
    SELECT count(*)::int n, count(*) FILTER (WHERE source_label LIKE '사장님%')::int owner,
           count(DISTINCT pattern_code)::int pats FROM kumho_material`);
  console.log(`자재 마스터 ${m.n}줄 (사장님 확인분 ${m.owner}) · 패턴 ${m.pats}가지`);

  const [p] = await q<{ n: number; act: number; stock: number; items: number }>(sql`
    SELECT count(*)::int n, count(*) FILTER (WHERE is_active)::int act,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id=p.id AND s.status='재고'))::int stock,
           COALESCE(SUM((SELECT count(*) FROM stock_item s WHERE s.product_id=p.id AND s.status='재고')),0)::int items
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire'`);
  console.log(`금호 상품 ${p.n} (보임 ${p.act}) · 재고 ${p.stock}품목 ${p.items}본\n`);

  /* ① 상품이 「지금 유효한 자재코드」를 갖고 있는가 — 이게 핵심이다 */
  const [c] = await q<{ tot: number; live: number; old: number; none: number }>(sql`
    WITH x AS (
      SELECT p.id,
             EXISTS (SELECT 1 FROM supplier_item_code c JOIN kumho_material k ON k.code=c.code
                     WHERE c.product_id=p.id AND c.supplier='금호' AND k.op_type <> '④') live,
             EXISTS (SELECT 1 FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호') has_any
      FROM product p WHERE p.brand_code='KM' AND p.item_type='tire' AND p.is_active
    )
    SELECT count(*)::int tot, count(*) FILTER (WHERE live)::int live,
           count(*) FILTER (WHERE has_any AND NOT live)::int old,
           count(*) FILTER (WHERE NOT has_any)::int none FROM x`);
  console.log("보이는 금호 상품의 자재코드 상태");
  console.log(`  ✔ 지금 쓰는 자재코드 있음 ${c.live} / ${c.tot}`);
  console.log(`  △ 옛 코드만 있음         ${c.old}`);
  console.log(`  ✖ 자재코드 없음          ${c.none}`);

  const bad = await q<{ id: number; nm: string; stock: number; codes: string | null }>(sql`
    SELECT p.id, COALESCE(p.display_name,p.pattern) nm,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT string_agg(c.code,',') FROM supplier_item_code c WHERE c.product_id=p.id AND c.supplier='금호') codes
    FROM product p WHERE p.brand_code='KM' AND p.item_type='tire' AND p.is_active
      AND NOT EXISTS (SELECT 1 FROM supplier_item_code c JOIN kumho_material k ON k.code=c.code
                      WHERE c.product_id=p.id AND c.supplier='금호' AND k.op_type <> '④')
      AND EXISTS (SELECT 1 FROM stock_item s WHERE s.product_id=p.id AND s.status='재고')
    ORDER BY 3 DESC`);
  console.log(`\n  그중 **재고가 있는데** 지금 쓰는 코드가 없는 상품 ${bad.length}개`);
  for (const b of bad.slice(0, 20)) console.log(`     #${b.id} ${b.nm} 재고${b.stock} · 코드 ${b.codes ?? "없음"}`);

  /* ② Master 에 있는데 우리 상품이 없는 자재 */
  const miss = await q<{ k: string; n: number }>(sql`
    SELECT CASE WHEN m.op_type='④' THEN '미운영·중단'
                WHEN m.op_status='비정상' THEN '비정상'
                WHEN COALESCE(m.price_excl,0)=0 THEN '기표가 없음'
                WHEN m.product_group IN ('PCR','LTR') THEN '★ 승용·SUV — 만들 수 있음'
                ELSE '트럭·특수' END k, count(*)::int n
    FROM kumho_material m
    WHERE NOT EXISTS (SELECT 1 FROM supplier_item_code s WHERE s.supplier='금호' AND s.code=m.code)
      AND NOT EXISTS (SELECT 1 FROM product p WHERE p.mars_item_no='KM'||m.code)
    GROUP BY 1 ORDER BY 2 DESC`);
  console.log("\n자재 마스터에만 있고 우리 상품엔 없는 것");
  for (const r of miss) console.log(`  ${r.k}: ${r.n}`);

  /* ③ 기표가·하중지수가 「지금 쓰는 코드」와 어긋나는 상품 */
  const [drift] = await q<{ price: number; li: number }>(sql`
    WITH pick AS (
      SELECT DISTINCT ON (c.product_id) c.product_id pid, m.price_excl, m.load_index
      FROM supplier_item_code c JOIN kumho_material m ON m.code=c.code
      WHERE c.supplier='금호'
      ORDER BY c.product_id, ${PICK_MATERIAL_ORDER}
    )
    SELECT count(*) FILTER (WHERE k.price_excl > 0 AND p.list_price_excl IS DISTINCT FROM k.price_excl)::int price,
           count(*) FILTER (WHERE k.load_index IS NOT NULL
                            AND split_part(COALESCE(p.load_index,''),'/',1) <> k.load_index)::int li
    FROM pick k JOIN product p ON p.id = k.pid`);
  console.log(`\n지금 쓰는 코드와 어긋나는 상품 — 기표가 ${drift.price} · 하중지수 ${drift.li} (0이어야 한다)`);

  /* ④ 이름·세부사항 */
  const [nm] = await q<{ names: number; code_name: number; no_ply: number; ac: number }>(sql`
    SELECT count(DISTINCT display_name)::int names,
           count(*) FILTER (WHERE display_name ~ '^[A-Z0-9]{2,6}( [0-9]+P)?$')::int code_name,
           count(*) FILTER (WHERE ply_rating IS NULL)::int no_ply,
           count(*) FILTER (WHERE is_acoustic)::int ac
    FROM product WHERE brand_code='KM' AND item_type='tire' AND is_active`);
  console.log(`\n이름 ${nm.names}가지 · 아직 코드가 이름인 것 ${nm.code_name} · 겹수 비어 있음 ${nm.no_ply} · 흡음재 ${nm.ac}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
