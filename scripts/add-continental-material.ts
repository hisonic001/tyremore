/**
 * 콘티넨탈 자재 마스터 표 만들고 채우기 ⭐ (사장님 요청 2026-08-29)
 *
 *   npx tsx --env-file=.env.local scripts/add-continental-material.ts [--apply]
 *
 * 미쉐린은 MARS 마스터(CAI)가 DB 에 있어 인보이스의 새 품번도 대조가 된다.
 * 금호는 `kumho_material` 이 그 자리다. 콘티넨탈은 지금까지 그 자리가 **비어 있었다** —
 * 그래서 「이 자재번호가 진짜 있는 물건인가」를 확인할 근거가 없었다.
 *
 * 2026 목록 두 파일(여름·사계절 560 + 겨울 176 = 736)을 여기 적재한다.
 * 앞으로는 설정 > 상품 「목록 채우기」에서 올리면 저절로 채워진다.
 *
 * 🔴 미리보기가 기본이다. `--apply` 없이는 아무것도 저장하지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readContiAll } from "@/lib/conti-sheet";

const APPLY = process.argv.includes("--apply");
async function main() {
  const rows = readContiAll();
  const codes = new Set(rows.map((r) => r.code));
  console.log(`합계 ${rows.length}줄 · 자재번호 고유 ${codes.size} · 제너럴 ${rows.filter((r) => r.brandCode === "GN").length}`);
  if (codes.size !== rows.length) throw new Error("자재번호가 겹칩니다 — 자료를 확인해 주세요");

  if (!APPLY) {
    console.log("\n(미리보기입니다 — 저장하려면 --apply)");
    process.exit(0);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS continental_material (
      code text PRIMARY KEY,
      brand_code text NOT NULL,
      description text NOT NULL,
      marketing_line text,
      pattern_code text,
      model_name text NOT NULL,
      season text,
      rim_inch numeric(4,1),
      size_code text,
      coc text,
      price_excl integer NOT NULL,
      source_label text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conti_material_model ON continental_material (model_name)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_conti_material_season ON continental_material (season)`);

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO continental_material (code, brand_code, description, marketing_line, pattern_code, model_name,
                                        season, rim_inch, size_code, coc, price_excl, source_label, updated_at)
      VALUES (${r.code}, ${r.brandCode}, ${r.desc}, ${r.marketingLine}, ${r.patternCode}, ${r.parsed.name},
              ${r.season}, ${r.rimInch}, ${r.sizeCode}, ${r.coc}, ${r.priceExcl}, ${r.sourceLabel}, now())
      ON CONFLICT (code) DO UPDATE SET
        brand_code = EXCLUDED.brand_code, description = EXCLUDED.description,
        marketing_line = EXCLUDED.marketing_line, pattern_code = EXCLUDED.pattern_code,
        model_name = EXCLUDED.model_name, season = EXCLUDED.season, rim_inch = EXCLUDED.rim_inch,
        size_code = EXCLUDED.size_code, coc = EXCLUDED.coc, price_excl = EXCLUDED.price_excl,
        source_label = EXCLUDED.source_label, updated_at = now()`);
  }

  const [n] = await db.execute<{ n: number; models: number; win: number; coc: number }>(sql`
    SELECT count(*)::int n, count(DISTINCT model_name)::int models,
           count(*) FILTER (WHERE season = '겨울')::int win,
           count(*) FILTER (WHERE coc IS NOT NULL AND coc <> '')::int coc
    FROM continental_material`);
  console.log(`✅ 자재 ${n.n}줄 · 모델 ${n.models}가지 · 겨울 ${n.win} · COC 표시 ${n.coc}`);

  // 우리 상품과 얼마나 이어지나 (아직 잇지는 않는다 — conti-apply 가 한다)
  const [c] = await db.execute<{ have: number; missing: number }>(sql`
    SELECT count(*) FILTER (WHERE p.id IS NOT NULL)::int have,
           count(*) FILTER (WHERE p.id IS NULL)::int missing
    FROM continental_material m
    LEFT JOIN product p ON p.mars_item_no = m.brand_code || m.code`);
  console.log(`   품번으로 바로 이어지는 것 ${c.have} · 새로 만들어야 할 것 ${c.missing}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
