/**
 * 타이어 재계산 — 규격(폭·편평비·림) · 계절 · 런플랫 · 흡음재 · SUV
 *
 * 1차 이관에서 계절 판정을 `raw_name`("Michelin 225/45 R 17 94Y TL")에 돌리는 바람에
 * 10,318건 중 3건만 분류됐다. 모델명은 `pattern`에 있다 (2026-08-01 발견).
 *
 * 판정·파싱 규칙을 고칠 때마다 다시 돌리면 된다. 원문을 보존해 둔 이유가 이것이다.
 *
 * 🔴 **사장님이 손으로 고친 값은 건드리지 않는다** (2026-08-03).
 *    `attrs_override` 가 있는 상품은 통째로 건너뛴다.
 *    이게 없으면 규칙을 고칠 때마다 애써 고쳐 놓은 것이 날아간다.
 *
 *   npx tsx scripts/backfill-attrs.ts          실제로 반영
 *   npx tsx scripts/backfill-attrs.ts --dry    바뀌는 것만 보여주고 끝
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const dry = process.argv.includes("--dry");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { parseTireAttrs } = await import("../src/lib/tire-attrs");
  const { parseTireSpec } = await import("../src/lib/tire-spec");

  const rows = await db.execute<{
    id: number;
    pattern: string | null;
    raw_name: string;
    override: Record<string, unknown> | null;
    width: number | null;
    aspect_ratio: number | null;
    rim_inch: string | null;
  }>(sql`
    SELECT id, pattern, raw_name, attrs_override AS override, width, aspect_ratio, rim_inch
    FROM product WHERE item_type = 'tire'
  `);
  console.log(`타이어 ${rows.length}건 재계산${dry ? " (미리보기 — 아무것도 저장하지 않습니다)" : ""}`);

  // ── 1. 속성 (계절·런플랫·흡음재·SUV) ──
  // 값이 같은 것끼리 묶어 한 번에 갱신한다 (1만 건을 한 줄씩 치면 느리다)
  const buckets = new Map<string, number[]>();
  let kept = 0;
  for (const r of rows) {
    /**
     * 손으로 고친 항목이 하나라도 있으면 그 상품은 통째로 건너뛴다.
     * 일부만 덮어쓰면 사장님이 「왜 이것만 돌아왔지」 하게 된다.
     */
    if (Object.keys(r.override ?? {}).length > 0) {
      kept++;
      continue;
    }
    const a = parseTireAttrs(r.pattern, r.raw_name);
    const key = `${a.season ?? ""}|${a.isRunflat}|${a.isAcoustic}|${a.isSuv}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(Number(r.id));
  }
  if (kept) console.log(`   사장님이 고친 ${kept}건은 그대로 둡니다`);

  for (const [key, ids] of buckets) {
    const [season, rf, ac, suv] = key.split("|");
    const label =
      `${String(ids.length).padStart(5)}  ${season || "(미분류)"}` +
      `${rf === "true" ? " 런플랫" : ""}${ac === "true" ? " 흡음재" : ""}${suv === "true" ? " SUV" : ""}`;
    console.log(`   ${label}`);
    if (dry) continue;
    for (let i = 0; i < ids.length; i += 2000) {
      const chunk = ids.slice(i, i + 2000);
      await db.execute(sql`
        UPDATE product SET
          season = ${season || null},
          is_runflat = ${rf === "true"},
          is_acoustic = ${ac === "true"},
          is_suv = ${suv === "true"},
          updated_at = now()
        WHERE id = ANY(${sql.raw(`ARRAY[${chunk.join(",")}]::bigint[]`)})
      `);
    }
  }

  /**
   * ── 2. 규격 ──
   * 편평비 없는 밴 규격(145R13)을 못 읽던 것을 고쳤다 (2026-08-03 사장님 지적).
   * 규격은 값이 제각각이라 묶을 수 없으니 **바뀐 것만** 한 줄씩 고친다.
   */
  let specFixed = 0;
  for (const r of rows) {
    const s = parseTireSpec(r.raw_name);
    if (!s.parsed) continue;
    const eq = (a: unknown, b: unknown) =>
      (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));
    if (eq(r.width, s.width) && eq(r.aspect_ratio, s.aspectRatio) && eq(r.rim_inch, s.rimInch)) continue;
    specFixed++;
    if (specFixed <= 20) {
      console.log(
        `   규격 #${r.id}  ${r.width}/${r.aspect_ratio}R${r.rim_inch} → ` +
          `${s.width}/${s.aspectRatio ?? "—"}R${s.rimInch}   «${r.raw_name.trim()}»`,
      );
    }
    if (dry) continue;
    await db.execute(sql`
      UPDATE product SET width = ${s.width}, aspect_ratio = ${s.aspectRatio},
                         rim_inch = ${s.rimInch}, updated_at = now()
      WHERE id = ${r.id}
    `);
  }
  console.log(`   규격이 바뀐 상품 ${specFixed}건`);

  const check = await db.execute<{ season: string | null; n: number }>(
    sql`SELECT season, count(*)::int n FROM product WHERE item_type='tire' GROUP BY season ORDER BY n DESC`,
  );
  console.log("\n최종 계절 분포:");
  for (const c of check) console.log(`   ${String(c.n).padStart(5)}  ${c.season ?? "(미분류)"}`);

  const [x] = await db.execute<{ rf: number; ac: number; suv: number }>(sql`
    SELECT count(*) FILTER (WHERE is_runflat)::int rf,
           count(*) FILTER (WHERE is_acoustic)::int ac,
           count(*) FILTER (WHERE is_suv)::int suv
    FROM product WHERE item_type='tire'
  `);
  console.log(`   런플랫 ${x.rf} · 흡음재 ${x.ac} · SUV ${x.suv}`);
  process.exit(0);
}
main();
