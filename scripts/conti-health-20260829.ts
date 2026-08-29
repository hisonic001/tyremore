/**
 * 콘티넨탈 품목 건강 검사 — 2026 목록 기준 (2026-08-29)
 *
 *   npx tsx --env-file=.env.local scripts/conti-health-20260829.ts
 *
 * 고치는 스크립트가 아니라 **재는** 스크립트다 (금호 `kumho-health` 와 같은 자리).
 * 다시 돌리면 나아졌는지 바로 보인다. 0 이어야 하는 줄에 🔴 를 붙여 뒀다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) => db.execute<T>(s);
const CO = sql`brand_code IN ('CO','GN')`;

async function main() {
  const [m] = await q<{ n: number; models: number; win: number; owner: number }>(sql`
    SELECT count(*)::int n, count(DISTINCT model_name)::int models,
           count(*) FILTER (WHERE season = '겨울')::int win,
           count(*) FILTER (WHERE source_label LIKE '사장님%')::int owner
    FROM continental_material`);
  console.log(`\n── ① 자재 마스터 ──`);
  console.log(`  ${m.n}줄 · 모델 ${m.models}가지 · 겨울 ${m.win} · 사장님 확인분 ${m.owner}`);

  const [p] = await q<{ all: number; act: number; hid: number; dict: number; noDict: number }>(sql`
    SELECT count(*)::int all, count(*) FILTER (WHERE is_active)::int act,
           count(*) FILTER (WHERE NOT is_active)::int hid,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM supplier_item_code c
             WHERE c.supplier = '콘티넨탈' AND c.product_id = product.id))::int dict,
           count(*) FILTER (WHERE is_active AND NOT EXISTS (SELECT 1 FROM supplier_item_code c
             WHERE c.supplier = '콘티넨탈' AND c.product_id = product.id))::int "noDict"
    FROM product WHERE ${CO}`);
  console.log(`\n── ② 상품 ──`);
  console.log(`  ${p.all}품목 (보임 ${p.act} · 접힘 ${p.hid}) · 거래처 사전에 이어진 것 ${p.dict}`);
  console.log(`  ${p.noDict === 0 ? "  ✓" : "🔴"} 보이는데 자재번호가 없는 것 ${p.noDict}`);

  const [v] = await q<{ vat: number; noPrice: number; noName: number; hiddenStock: number }>(sql`
    SELECT count(*) FILTER (WHERE list_price_excl IS NOT NULL
             AND list_price IS DISTINCT FROM round(list_price_excl * 1.1))::int vat,
           count(*) FILTER (WHERE is_active AND list_price_excl IS NULL)::int "noPrice",
           count(*) FILTER (WHERE is_active AND (display_name IS NULL OR display_name = ''))::int "noName",
           count(*) FILTER (WHERE NOT is_active AND EXISTS (SELECT 1 FROM stock_item s
             WHERE s.product_id = product.id AND s.status = '재고' AND s.qty > 0))::int "hiddenStock"
    FROM product WHERE ${CO}`);
  console.log(`\n── ③ 어긋남 (전부 0 이어야 한다) ──`);
  console.log(`  ${v.vat === 0 ? "  ✓" : "🔴"} 부가세 규칙(화면가 = 기표가×1.1) 어긋남 ${v.vat}`);
  console.log(`  ${v.noPrice === 0 ? "  ✓" : "🔴"} 보이는데 기표가 없는 것 ${v.noPrice}`);
  console.log(`  ${v.noName === 0 ? "  ✓" : "🔴"} 보이는데 이름 빈 것 ${v.noName}`);
  console.log(`  ${v.hiddenStock === 0 ? "  ✓" : "🔴"} 재고가 있는데 접힌 것 ${v.hiddenStock}`);

  /**
   * 보이는 것 중 쌍둥이 — 규격·하중·겹수·OE마크·이름이 모두 같은 것.
   * 🔴 남아 있어도 무조건 잘못은 아니다. 콘티넨탈 목록 자체가 같은 이름에 자재번호를
   *    둘 주는 경우가 있다 (실측: 235/35R19 SportContact 7 — `(91Y)` 와 `91Y` 표기 차이).
   *    둘 다 주문할 수 있는 물건이라 **우리가 임의로 합치지 않는다.** 눈에만 띄게 둔다.
   */
  const dups = await q<{ spec: string; who: string }>(sql`
    SELECT width || '/' || aspect_ratio || 'R' || rim_inch || ' ' ||
           COALESCE(load_index, '') || COALESCE(speed_rating, '') spec,
           string_agg(mars_item_no || ' ' || COALESCE(display_name, ''), ' | ') who
    FROM product WHERE ${CO} AND is_active
      /* 🔴 기호를 지우면 안 된다 — 「#」「★」「(+)」 는 다른 물건을 가르는 표시다
            (실측 2026-08-29: DWS06 PLUS 와 DWS06 PLUS # 가 같은 것으로 잡혔다).
            OE 마크도 열쇠에 넣는다. 금호 때 겹수를 안 넣어 데인 것과 같은 자리다. */
    GROUP BY brand_code, width, aspect_ratio, rim_inch, load_index, speed_rating,
             COALESCE(ply_rating, -1), COALESCE(oe_marks, ''),
             lower(replace(COALESCE(display_name, pattern, ''), ' ', ''))
    HAVING count(*) > 1`);
  console.log(`  ${dups.length === 0 ? "  ✓" : "  ·"} 겉이 같은 묶음 ${dups.length}개 (콘티넨탈 목록이 번호를 둘 준 것 — 합치지 않는다)`);
  for (const x of dups) console.log(`       ${x.spec}  ${x.who}`);

  const [n] = await q<{ names: number; auto: number; edited: number; season: number; oe: number; rf: number; ac: number }>(sql`
    SELECT count(DISTINCT display_name)::int names,
           count(*) FILTER (WHERE name_auto IS NOT NULL)::int auto,
           count(*) FILTER (WHERE name_auto IS NOT NULL AND display_name IS DISTINCT FROM name_auto)::int edited,
           count(*) FILTER (WHERE season IS NULL)::int season,
           count(*) FILTER (WHERE oe_marks IS NOT NULL)::int oe,
           count(*) FILTER (WHERE is_runflat)::int rf,
           count(*) FILTER (WHERE is_acoustic)::int ac
    FROM product WHERE ${CO} AND is_active`);
  console.log(`\n── ④ 이름·속성 (보이는 것 ${p.act}품목) ──`);
  console.log(`  이름 ${n.names}가지 · 규칙이 채운 것 ${n.auto} · 사장님이 고친 것 ${n.edited}`);
  console.log(`  계절 없음 ${n.season} · OE 마크 ${n.oe} · 런플랫 ${n.rf} · 흡음재 ${n.ac}`);

  const [s] = await q<{ items: number; qty: number }>(sql`
    SELECT count(DISTINCT p.id)::int items, COALESCE(SUM(st.qty), 0)::int qty
    FROM product p JOIN stock_item st ON st.product_id = p.id AND st.status = '재고'
    WHERE p.${sql.raw("brand_code")} IN ('CO','GN')`);
  console.log(`\n── ⑤ 재고 ──`);
  console.log(`  ${s.items}품목 · ${s.qty}본`);

  const orphan = await q<{ code: string; model_name: string; description: string }>(sql`
    SELECT m.code, m.model_name, m.description FROM continental_material m
    LEFT JOIN product p ON p.mars_item_no = m.brand_code || m.code
    WHERE p.id IS NULL LIMIT 10`);
  console.log(`\n── ⑥ 마스터에만 있고 상품이 없는 것 ──`);
  console.log(`  ${orphan.length === 0 ? "  ✓ 없음" : `🔴 ${orphan.length}건`}`);
  for (const o of orphan) console.log(`     ${o.code} ${o.model_name} — ${o.description}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
