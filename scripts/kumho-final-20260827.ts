/**
 * 금호 마무리 — 사장님이 마지막으로 알려주신 코드 2건 + 미운영·중단 숨김 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-final-20260827.ts [--apply]
 *
 * ① 사장님 제공 (기표가 Master 에 없는 코드 — 값은 **부가세 포함**으로 주셔서 ÷1.1)
 *      5009992 DS 195/85 R16 14L UA100 ;RC   118L  126,500 → 115,000  → #1293
 *      2392102 KH 145    R13CR08L KC53 AR;RC  88R   79,200 →  72,000  → #30865
 * ② 금호가 「미운영·중단」(유형 ④)으로 표시한 품목을 검색에서 숨긴다 — 사장님: "일단 숨김"
 *    🔴 재고가 있는 것은 숨기지 않는다. 창고에 있는 걸 못 팔면 안 된다.
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { SUPPLIER } from "@/lib/kumho-sheet";
import { readMaster } from "@/lib/kumho-master";

const APPLY = process.argv.includes("--apply");

const OWNER: { pid: number; code: string; name: string; incl: number; li: string; ss: string }[] = [
  { pid: 1293, code: "5009992", name: "DS 195/85  R16  14L UA100  ;RC", incl: 126500, li: "118", ss: "L" },
  { pid: 30865, code: "2392102", name: "KH 145     R13CR08L KC53 AR;RC", incl: 79200, li: "88", ss: "R" },
];

async function main() {
  console.log(APPLY ? "실제 반영" : "미리보기");

  /* ① 사장님이 주신 코드 */
  for (const o of OWNER) {
    const excl = Math.round(o.incl / 1.1);
    const [prev] = await db.execute<{ product_id: number; nm: string | null }>(sql`
      SELECT c.product_id, COALESCE(p.display_name, p.pattern) nm FROM supplier_item_code c
      JOIN product p ON p.id = c.product_id WHERE c.supplier=${SUPPLIER} AND c.code=${o.code}`);
    const [me] = await db.execute<{ nm: string | null; excl: number | null; li: string | null; ss: string | null; stock: number }>(sql`
      SELECT COALESCE(display_name, pattern) nm, list_price_excl excl, load_index li, speed_rating ss,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
      FROM product p WHERE id = ${o.pid}`);
    console.log(`\n#${o.pid} ${me?.nm} (재고 ${me?.stock}) ← 자재 ${o.code}`);
    console.log(`   기표가 ${me?.excl ?? "-"} → ${excl} (화면 ${o.incl.toLocaleString()}원) · 하중속도 ${me?.li ?? "-"}${me?.ss ?? ""} → ${o.li}${o.ss}`);
    if (prev && Number(prev.product_id) !== o.pid) console.log(`   ⚠ 지금 임자 #${prev.product_id} ${prev.nm} — 옮깁니다`);
    if (!APPLY) continue;
    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
      VALUES (${SUPPLIER}, ${o.code}, ${o.pid}, ${o.name}, '사장님확인', now(), now())
      ON CONFLICT (supplier, code) DO UPDATE
        SET product_id = EXCLUDED.product_id, supplier_name = EXCLUDED.supplier_name, matched_by = '사장님확인', updated_at = now()`);
    await db.execute(sql`
      UPDATE product SET list_price_excl = ${excl}, list_price = ${o.incl},
             load_index = COALESCE(load_index, ${o.li}), speed_rating = COALESCE(speed_rating, ${o.ss}), updated_at = now()
      WHERE id = ${o.pid}`);
  }

  /* ② 미운영·중단(유형 ④) 숨기기 */
  const wb = XLSX.readFile("C:/Users/info/OneDrive/문서/통합자동화/금호 상품목록/금호타이어_기표가(26년7월).xlsx");
  const { rows: cat } = readMaster(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }));
  const dead = cat.filter((r) => r.type === "④").map((r) => r.code);
  const live = new Set(cat.filter((r) => r.type !== "④").map((r) => r.code));
  console.log(`\n미운영·중단 코드 ${dead.length}개`);

  const rows = await db.execute<{ id: number; nm: string | null; act: boolean; stock: number; codes: string | null }>(sql`
    SELECT DISTINCT p.id, COALESCE(p.display_name, p.pattern) nm, p.is_active act,
           (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
           (SELECT string_agg(c2.code, ',' ORDER BY c2.code) FROM supplier_item_code c2 WHERE c2.product_id=p.id AND c2.supplier=${SUPPLIER}) codes
    FROM supplier_item_code c JOIN product p ON p.id = c.product_id
    WHERE c.supplier = ${SUPPLIER} AND c.code IN ${sql.raw("(" + dead.map((c) => `'${c}'`).join(",") + ")")}`);

  /* 🔴 살아 있는 코드도 함께 붙어 있으면 그 상품은 여전히 판다 — 숨기지 않는다 */
  const stillLive = rows.filter((r) => (r.codes ?? "").split(",").some((c) => live.has(c)));
  const hasStock = rows.filter((r) => r.stock > 0 && !stillLive.includes(r));
  const toHide = rows.filter((r) => r.act && r.stock === 0 && !stillLive.includes(r));

  console.log(`  걸린 우리 품목 ${rows.length} — 숨길 것 ${toHide.length} · 재고가 있어 그대로 ${hasStock.length} · 살아 있는 코드도 있어 그대로 ${stillLive.length}`);
  for (const r of hasStock) console.log(`    (재고 유지) #${r.id} ${r.nm} 재고 ${r.stock}`);
  for (const r of stillLive) console.log(`    (신코드 있음) #${r.id} ${r.nm} ${r.codes}`);
  if (APPLY && toHide.length) {
    for (let i = 0; i < toHide.length; i += 200) {
      const ids = toHide.slice(i, i + 200).map((r) => Number(r.id));
      await db.execute(sql`UPDATE product SET is_active = false, hidden_reason = '금호 미운영·중단(26.07)', updated_at = now()
                           WHERE id IN ${sql.raw("(" + ids.join(",") + ")")}`);
    }
    console.log(`  ✔ ${toHide.length}품목 숨김`);
  }

  const chk = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT p.id)::int n FROM product p JOIN stock_item s ON s.product_id=p.id AND s.status='재고'
    WHERE p.brand_code='KM' AND NOT p.is_active`);
  console.log(`\n재고 있는데 숨겨진 금호: ${chk[0].n} (0이어야 한다)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
