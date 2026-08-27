/**
 * 사장님이 직접 알려주신 금호 자재코드 반영 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-owner-codes-20260827.ts [--apply]
 *
 * 「재고는 있는데 목록에 없다」던 17품목 중 8개의 자재코드를 사장님이 확인해 주셨다.
 * 여덟 개 모두 **쌍둥이 품목이 그 코드를 물고 있었다** — 코드를 사장님이 지목한 쪽으로 옮기고
 * 기표가를 목록 값으로 맞춘다. 재고가 움직이는 「합치기」는 여기서 하지 않는다(따로 확인).
 *
 * 🔴 목록에 없는 코드 둘은 사장님이 값을 주셨다 (부가세 **포함**가로 주셔서 ÷1.1 한다):
 *      2420172 KH 145 R13CR12L KC55 ;RC CHINA 94R  96,800원 → 88,000원(미포함)
 *      2172062 KH 225/60 R17 H04S KL33 HH;RK 99H  209,000원 → 190,000원(미포함)
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { SUPPLIER } from "@/lib/kumho-sheet";
import { readMaster } from "@/lib/kumho-master";

const APPLY = process.argv.includes("--apply");

/** [품목번호, 자재코드, 목록에 없을 때 쓸 {이름, 부가세포함가}] */
const OWNER: { pid: number; code: string; manual?: { name: string; incl: number; li: string; ss: string }; memo?: string }[] = [
  { pid: 8946, code: "2413032" },
  { pid: 8495, code: "5011792" },
  { pid: 44085, code: "2420172", manual: { name: "KH 145     R13CR12L KC55 ;RC CHINA", incl: 96800, li: "94", ss: "R" } },
  { pid: 44086, code: "5010062", memo: "중단 상품 — 재고 소진용" },
  { pid: 8885, code: "2375102" },
  { pid: 44094, code: "2387942" },
  { pid: 8470, code: "2172062", manual: { name: "KH 225/60  R17 H04S KL33 HH;RK", incl: 209000, li: "99", ss: "H" } },
  { pid: 8863, code: "2387832" },
];

async function main() {
  const wb = XLSX.readFile("C:/Users/info/OneDrive/문서/통합자동화/금호 상품목록/금호타이어_기표가(26년7월).xlsx");
  const { rows: cat } = readMaster(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }));
  const M = new Map(cat.map((r) => [r.code, r]));
  console.log(APPLY ? "실제 반영" : "미리보기");

  const merges: { keep: number; absorb: number; why: string }[] = [];
  for (const o of OWNER) {
    const m = M.get(o.code);
    const name = m?.name ?? o.manual?.name ?? "";
    const excl = m?.priceExcl ?? (o.manual ? Math.round(o.manual.incl / 1.1) : null);
    const [prev] = await db.execute<{ product_id: number; nm: string | null; stock: number }>(sql`
      SELECT c.product_id, COALESCE(p.display_name, p.pattern) nm,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
      FROM supplier_item_code c JOIN product p ON p.id=c.product_id
      WHERE c.supplier=${SUPPLIER} AND c.code=${o.code}`);
    const [me] = await db.execute<{ excl: number | null; nm: string | null; stock: number; act: boolean }>(sql`
      SELECT p.list_price_excl excl, COALESCE(p.display_name, p.pattern) nm, p.is_active act,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
      FROM product p WHERE p.id = ${o.pid}`);

    const moved = prev && Number(prev.product_id) !== o.pid;
    console.log(`\n#${o.pid} ${(me?.nm ?? "").slice(0, 32)} (재고 ${me?.stock}) ← 자재 ${o.code}${m ? "" : " ⚠목록에 없음(사장님 제공)"}`);
    console.log(`   기표가 ${me?.excl ?? "-"} → ${excl ?? "-"}${o.memo ? ` · ${o.memo}` : ""}`);
    if (moved) {
      console.log(`   ⚠ 지금 이 코드의 임자: #${prev.product_id} ${prev.nm} (재고 ${prev.stock}) — 코드를 옮깁니다`);
      merges.push({ keep: o.pid, absorb: Number(prev.product_id), why: `자재 ${o.code} 쌍둥이` });
    }
    if (!APPLY) continue;

    await db.execute(sql`
      INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
      VALUES (${SUPPLIER}, ${o.code}, ${o.pid}, ${name}, '사장님확인', now(), now())
      ON CONFLICT (supplier, code) DO UPDATE
        SET product_id = EXCLUDED.product_id, supplier_name = EXCLUDED.supplier_name,
            matched_by = '사장님확인', updated_at = now()`);
    if (excl !== null) {
      await db.execute(sql`
        UPDATE product SET list_price_excl = ${excl}, list_price = ${Math.round(excl * 1.1)}, updated_at = now()
        WHERE id = ${o.pid}`);
    }
  }

  /* 🔴 #1300 은 편평비가 비어 있어 합치기가 거부된다 (브랜드·규격이 같아야 합친다) — 145/80R13 로 채운다 */
  const [p1300] = await db.execute<{ ar: number | null }>(sql`SELECT aspect_ratio ar FROM product WHERE id = 1300`);
  if (p1300 && p1300.ar === null) {
    console.log("\n#1300 편평비 비어 있음 → 80 으로 채움 (145/80R13)");
    if (APPLY) await db.execute(sql`UPDATE product SET aspect_ratio = 80, updated_at = now() WHERE id = 1300`);
  }

  console.log(`\n▼ 재고가 움직이는 합치기 후보 ${merges.length}건 — 따로 확인받고 진행`);
  for (const g of merges) {
    const rows = await db.execute<{ id: number; nm: string | null; stock: number; sold: number; mars: string | null; act: boolean }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) nm, p.mars_item_no mars, p.is_active act,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock,
             (SELECT count(*)::int FROM quote_item q WHERE q.product_id=p.id) sold
      FROM product p WHERE p.id IN (${g.keep}, ${g.absorb})`);
    const k = rows.find((r) => Number(r.id) === g.keep)!;
    const a = rows.find((r) => Number(r.id) === g.absorb)!;
    console.log(`   남길 #${k.id} ${k.nm} (재고 ${k.stock}·판매 ${k.sold}·${k.mars}) ← 흡수 #${a.id} ${a.nm} (재고 ${a.stock}·판매 ${a.sold}·${a.mars}${a.act ? "" : "·숨김"})`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
