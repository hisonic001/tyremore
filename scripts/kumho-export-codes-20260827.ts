/**
 * 받은 적 있는 물건 목록(금호 창고 실사 export.xlsx)으로 자재코드 사전 채우기 (사장님 제공 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-export-codes-20260827.ts [--apply]
 *
 * 사장님: "재고는 맞지 않지만 한번이라도 받았던 물건들의 목록임"
 *
 * 이 목록의 코드는 대부분 **옛 자재코드**다(금호가 26년에 코드를 갈아엎기 전 것).
 * 우리 `mars_item_no`·`barcode` 가 `KM`+그 코드로 되어 있어 **품번으로 딱 맞출 수 있다** —
 * 기표가 Master(신코드)로는 못 풀던 것들이 여기서 풀린다.
 *
 * 사전은 코드→상품이라 한 상품에 옛 코드·새 코드가 함께 붙어도 된다.
 * 옛 코드로 온 예전 인보이스도, 새 코드로 오는 앞으로의 인보이스도 같은 상품을 찾는다.
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { parseTireSpec } from "@/lib/tire-spec";
import { normalizeKumhoName } from "@/lib/kumho-master";
import { SUPPLIER } from "@/lib/kumho-sheet";

const APPLY = process.argv.includes("--apply");
const FILE = "C:/Users/info/Downloads/export.xlsx";

interface E { code: string; name: string; pat: string; qty: number; w: number | null; ar: number | null; rim: string | null; li: string | null; ss: string | null }

function readExport(): E[] {
  const wb = XLSX.readFile(FILE);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false });
  const out: E[] = [];
  for (const r of aoa.slice(1)) {
    const code = String(r[1] ?? "").trim();
    if (!/^\d{5,9}$/.test(code)) continue;
    const name = String(r[2] ?? "").trim();
    const s = parseTireSpec(normalizeKumhoName(name));
    out.push({
      code, name, pat: String(r[3] ?? "").toUpperCase(), qty: Number(r[5]) || 0,
      w: s.width, ar: s.aspectRatio, rim: s.rimInch === null ? null : String(s.rimInch),
      li: s.loadIndex ?? null, ss: s.speedRating ?? null,
    });
  }
  return out;
}

async function main() {
  const ex = readExport();
  console.log(`${APPLY ? "실제 반영" : "미리보기"} · 받은 적 있는 물건 ${ex.length}줄`);
  const have = new Set((await db.execute<{ code: string }>(sql`SELECT code FROM supplier_item_code WHERE supplier=${SUPPLIER}`)).map((r) => r.code));

  let byNo = 0, bySpec = 0, already = 0;
  const left: E[] = [];
  const links: { code: string; pid: number; how: string; nm: string }[] = [];

  for (const x of ex) {
    if (have.has(x.code)) { already++; continue; }
    /* 1순위 — 품번·바코드가 KM+코드. 가장 확실하다 (흡음·STUD 꼬리표가 붙어 있어도 앞이 같으면 같은 물건) */
    const byItemNo = await db.execute<{ id: number; nm: string | null; stock: number }>(sql`
      SELECT p.id, COALESCE(p.display_name, p.pattern) nm,
             (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
      FROM product p WHERE p.brand_code='KM'
        AND (p.mars_item_no = ${"KM" + x.code} OR p.barcode = ${"KM" + x.code} OR p.barcode LIKE ${"KM" + x.code + "%"})
      ORDER BY (SELECT count(*) FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') DESC, p.id LIMIT 2`);
    if (byItemNo.length === 1) {
      links.push({ code: x.code, pid: Number(byItemNo[0].id), how: "품번", nm: byItemNo[0].nm ?? "" });
      byNo++;
      continue;
    }
    /* 2순위 — 규격+패턴+하중속도로 딱 하나. 임자가 있어도 코드는 하나 더 붙일 수 있다(재코드) */
    if (x.w !== null && x.rim !== null) {
      const cands = await db.execute<{ id: number; nm: string | null; stock: number }>(sql`
        SELECT p.id, COALESCE(p.display_name, p.pattern) nm,
               (SELECT count(*)::int FROM stock_item s WHERE s.product_id=p.id AND s.status='재고') stock
        FROM product p WHERE p.brand_code='KM' AND p.item_type='tire'
          AND p.width = ${x.w} AND p.rim_inch = ${x.rim} AND p.aspect_ratio IS NOT DISTINCT FROM ${x.ar}
          AND (p.pattern ILIKE ${"%" + x.pat + "%"} OR p.raw_name ILIKE ${"%" + x.pat + "%"} OR p.display_name ILIKE ${"%" + x.pat + "%"})
          AND (${x.li}::text IS NULL OR p.load_index IS NULL OR p.load_index = ${x.li})
          AND (${x.ss}::text IS NULL OR p.speed_rating IS NULL OR upper(p.speed_rating) = ${x.ss})
        LIMIT 4`);
      if (cands.length === 1) {
        links.push({ code: x.code, pid: Number(cands[0].id), how: "규격+패턴", nm: cands[0].nm ?? "" });
        bySpec++;
        continue;
      }
    }
    left.push(x);
  }

  console.log(`\n이미 사전에 있음 ${already} · 품번으로 ${byNo} · 규격+패턴으로 ${bySpec} · 못 정함 ${left.length}`);
  for (const l of links) console.log(`  ${l.code} → #${l.pid} ${l.nm} (${l.how})`);
  console.log(`\n못 정한 ${left.length}줄:`);
  for (const x of left) console.log(`  ${x.code} ${x.pat} ${x.name.slice(0, 34)} 창고 ${x.qty}`);

  if (APPLY) {
    for (const l of links) {
      const x = ex.find((e) => e.code === l.code)!;
      await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
        VALUES (${SUPPLIER}, ${l.code}, ${l.pid}, ${x.name}, ${"받은목록-" + l.how}, now(), now())
        ON CONFLICT (supplier, code) DO NOTHING`);
    }
    console.log(`\n✔ 사전에 ${links.length}줄 넣음`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
