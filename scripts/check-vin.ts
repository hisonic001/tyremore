/**
 * 차대번호 어긋남 점검 (2026-09-04)
 *
 * 🔴 **세대가 틀리면 다른 차의 휠너트 토크가 뜬다.** 그래서 이 점검이 필요하다.
 *    차대번호는 차종을 해독해 주지는 못하지만(4~9자리 뜻이 비공개),
 *    **적힌 코드가 차대번호와 어긋나는 차는 잡아낸다.** 실측으로 두 건 나왔다:
 *      · 2024년 「포터2(HR)」 — 형제 차대번호가 전부 EV 다
 *      · 2017년 「싼타페(TM)」 — 차대번호 몸통이 DM 이다
 *
 * 🔴 **고치지 않는다. 목록만 낸다.** 어느 쪽이 맞는지는 사람이 판단할 일이다.
 *
 *   npx tsx scripts/check-vin.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
import { parseVin } from "../src/lib/vin";

config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let problems = 0;
  try {
    /* ── ① 앞 9자리는 같은데 세대 라벨이 갈리는 차 ── */
    const mixed = await sql<
      { k: string; plate_no: string; model: string | null; year: number | null; variant_key: string }[]
    >`
      WITH labelled AS (
        SELECT upper(left(btrim(v.vin), 9)) k, v.plate_no, v.model, v.year, g.variant_key
        FROM vehicle v JOIN vehicle_generation g ON g.id = v.generation_id
        WHERE v.is_active AND length(btrim(v.vin)) = 17
      )
      SELECT * FROM labelled
      WHERE k IN (SELECT k FROM labelled GROUP BY k HAVING count(DISTINCT variant_key) > 1)
      ORDER BY k, year`;
    console.log("① 차대번호 앞자리는 같은데 적힌 세대가 갈리는 차");
    if (!mixed.length) console.log("   없음 ✅");
    let lastK = "";
    for (const r of mixed) {
      if (r.k !== lastK) {
        console.log(`   ── ${r.k}`);
        lastK = r.k;
      }
      console.log(`      ${r.plate_no.padEnd(9)} ${String(r.year ?? "?").padStart(4)}년 ${(r.model ?? "").padEnd(22)} → ${r.variant_key}`);
    }
    /* 무리 안에서 소수파가 의심스럽다 */
    const byKey = new Map<string, Map<string, number>>();
    for (const r of mixed) {
      if (!byKey.has(r.k)) byKey.set(r.k, new Map());
      const m = byKey.get(r.k)!;
      m.set(r.variant_key, (m.get(r.variant_key) ?? 0) + 1);
    }
    for (const [k, m] of byKey) {
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const [top, ...rest] = sorted;
      for (const [key, n] of rest) {
        problems++;
        console.log(`   ⚠️ ${k}: 다수가 ${top[0]}(${top[1]}대)인데 ${key}(${n}대)가 섞여 있습니다 — 오타일 수 있습니다`);
      }
    }

    /* ── ② 차대번호 연식과 등록 연식이 크게 어긋나는 차 ── */
    const cars = await sql<{ plate_no: string; vin: string; model: string | null; year: number }[]>`
      SELECT plate_no, btrim(vin) vin, model, year FROM vehicle
      WHERE is_active AND length(btrim(vin)) = 17 AND year IS NOT NULL`;
    console.log("\n② 차대번호 10번째 글자(연식)와 등록 연식이 2년 넘게 어긋나는 차");
    let off = 0;
    for (const c of cars) {
      const v = parseVin(c.vin);
      if (!v.year) continue;
      const d = Number(c.year) - v.year;
      if (Math.abs(d) <= 2) continue;
      off++;
      problems++;
      console.log(
        `   ${c.plate_no.padEnd(9)} 등록 ${c.year}년 · 차대번호는 ${v.year}년형 (${d > 0 ? "+" : ""}${d}) ${(c.model ?? "").slice(0, 22)}`,
      );
    }
    if (!off) console.log("   없음 ✅");
    console.log(`   (전체 ${cars.length}대 중 ${off}대)`);

    console.log(`\n결과: 확인할 것 ${problems}가지${problems ? " ⚠️" : " ✅"}`);
    console.log("고치지 않았습니다 — 어느 쪽이 맞는지는 사장님이 보고 정하실 일입니다.");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
