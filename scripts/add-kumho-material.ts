/**
 * 금호 자재 마스터 표 만들고 채우기 (사장님 요청 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/add-kumho-material.ts [파일경로]
 *
 * 미쉐린은 MARS 마스터(CAI)가 DB 에 있어 인보이스의 새 품번도 대조가 된다.
 * 금호는 이 표가 그 자리다 — 여기 있어야 새 자재코드를 **검증하고** 상품을 만들 수 있다.
 * 앞으로는 설정 > 상품 화면에서 「기표가 목록」을 올리면 저절로 채워진다.
 */
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readMaster } from "@/lib/kumho-master";

const FILE = process.argv[2] ?? "C:/Users/info/OneDrive/문서/통합자동화/금호 상품목록/금호타이어_기표가(26년7월).xlsx";
const LABEL = "기표가(26년7월)";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kumho_material (
      code text PRIMARY KEY,
      name text NOT NULL,
      pattern_code text NOT NULL,
      product_group text,
      op_type text,
      op_status text,
      load_index text,
      speed_rating text,
      price_excl integer,
      origin text,
      source_label text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_kumho_material_pattern ON kumho_material (pattern_code)`);

  const wb = XLSX.readFile(FILE);
  const { rows, skipped } = readMaster(
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false }),
  );
  console.log(`${FILE}\n읽음 ${rows.length}줄 (건너뜀 ${skipped})`);

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO kumho_material (code, name, pattern_code, product_group, op_type, op_status,
                                  load_index, speed_rating, price_excl, origin, source_label, updated_at)
      VALUES (${r.code}, ${r.name}, ${r.patternCode}, ${r.group}, ${r.type}, ${r.status},
              ${r.loadIndex}, ${r.speedRating}, ${r.priceExcl}, ${r.origin || null}, ${LABEL}, now())
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, pattern_code = EXCLUDED.pattern_code, product_group = EXCLUDED.product_group,
        op_type = EXCLUDED.op_type, op_status = EXCLUDED.op_status, load_index = EXCLUDED.load_index,
        speed_rating = EXCLUDED.speed_rating, price_excl = EXCLUDED.price_excl,
        origin = EXCLUDED.origin, source_label = EXCLUDED.source_label, updated_at = now()`);
  }

  const [n] = await db.execute<{ n: number; pats: number }>(sql`
    SELECT count(*)::int n, count(DISTINCT pattern_code)::int pats FROM kumho_material`);
  console.log(`✅ 자재 ${n.n}줄 · 패턴 ${n.pats}가지`);
  const [cover] = await db.execute<{ n: number; linked: number }>(sql`
    SELECT count(*)::int n,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM supplier_item_code s
                                          WHERE s.supplier='금호' AND s.code = m.code))::int linked
    FROM kumho_material m`);
  console.log(`   그중 우리 상품에 이어진 코드 ${cover.linked}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
