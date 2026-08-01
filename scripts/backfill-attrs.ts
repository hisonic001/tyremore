/**
 * 타이어 속성 재계산 — 계절 · 런플랫 · 흡음재 · SUV
 *
 * 1차 이관에서 계절 판정을 `raw_name`("Michelin 225/45 R 17 94Y TL")에 돌리는 바람에
 * 10,318건 중 3건만 분류됐다. 모델명은 `pattern`에 있다 (2026-08-01 발견).
 *
 * 분류 규칙을 고칠 때마다 다시 돌리면 된다. 원문을 보존해 둔 이유가 이것이다.
 *
 *   npx tsx scripts/backfill-attrs.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { parseTireAttrs } = await import("../src/lib/tire-attrs");

  const rows = await db.execute<{ id: number; pattern: string | null; raw_name: string }>(
    sql`SELECT id, pattern, raw_name FROM product WHERE item_type = 'tire'`,
  );
  console.log(`타이어 ${rows.length}건 재계산`);

  // 값이 같은 것끼리 묶어 한 번에 갱신한다 (1만 건을 한 줄씩 치면 느리다)
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const a = parseTireAttrs(r.pattern, r.raw_name);
    const key = `${a.season ?? ""}|${a.isRunflat}|${a.isAcoustic}|${a.isSuv}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r.id);
  }

  for (const [key, ids] of buckets) {
    const [season, rf, ac, suv] = key.split("|");
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
    console.log(`   ${String(ids.length).padStart(5)}  ${season || "(미분류)"}${rf === "true" ? " 런플랫" : ""}${ac === "true" ? " 흡음재" : ""}${suv === "true" ? " SUV" : ""}`);
  }

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
