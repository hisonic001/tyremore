/**
 * 제원 현황 한 눈에 (2026-09-04)
 *   npx tsx scripts/spec-status.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{ label: string; n: number; tq: number; cars: number; host: string | null }[]>`
      SELECT g.label, count(s.id)::int n,
             count(*) FILTER (WHERE s.item = 'wheel_nut_torque')::int tq,
             (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id AND v.is_active) cars,
             (SELECT max(src.host) FROM spec_source src WHERE src.generation_id = g.id) host
      FROM vehicle_spec s JOIN vehicle_generation g ON g.id = s.generation_id
      GROUP BY g.id, g.label ORDER BY cars DESC`;
    let cars = 0;
    let vals = 0;
    console.log("제원이 들어온 차종:");
    for (const r of rows) {
      cars += r.cars;
      vals += r.n;
      const where = r.host === "www.hyundai.com" ? "자료실PDF" : "온라인";
      console.log(`  ${String(r.cars).padStart(3)}대  ${r.label.padEnd(18)} 값 ${String(r.n).padStart(3)}개 (토크 ${r.tq})  ${where}`);
    }
    const [tot] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM vehicle WHERE is_active`;
    const [wait] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM vehicle_spec WHERE status = '검수대기'`;
    const [ok] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM vehicle_spec WHERE status = '승인'`;
    const [src] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM spec_source`;
    console.log(`\n차종 ${rows.length}종 · 값 ${vals}개 · 해당 차량 ${cars}대 / 전체 ${tot.n}대`);
    console.log(`검수대기 ${wait.n}개 · 승인 ${ok.n}개 · 원문 ${src.n}장`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
