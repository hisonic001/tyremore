/**
 * 아직 제원이 없는 차종을 차 많은 순으로 보여 준다 (2026-09-04)
 *
 *   npx tsx scripts/spec-todo.ts          목록만
 *   npx tsx scripts/spec-todo.ts --keys   spec-fetch 에 넣을 코드만 한 줄로
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const keysOnly = process.argv.includes("--keys");
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 40;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{ k: string; label: string; maker: string; cars: number }[]>`
      SELECT g.variant_key k, g.label, m.maker_code maker,
             (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id AND v.is_active) cars
      FROM vehicle_generation g JOIN vehicle_model m ON m.id = g.model_id
      WHERE g.proj_code IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vehicle_spec s WHERE s.generation_id = g.id)
      ORDER BY cars DESC LIMIT ${limit}`;
    const useful = rows.filter((r) => r.cars > 0);
    if (keysOnly) {
      console.log(useful.map((r) => r.k).join(" "));
      return;
    }
    console.log(`제원이 없는 차종 ${useful.length}종 (차 ${useful.reduce((s, r) => s + r.cars, 0)}대)`);
    for (const r of useful) console.log(`  ${String(r.cars).padStart(3)}대  ${r.k.padEnd(9)} ${r.maker.padEnd(9)} ${r.label}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
