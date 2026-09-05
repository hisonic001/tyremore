/**
 * 부품 자료가 얼마나 믿을 만한가 — **재기만 한다. DB 를 바꾸지 않는다.** (2026-09-05)
 *
 *   npx tsx scripts/parts-audit.ts            전체 요약
 *   npx tsx scripts/parts-audit.ts --gen TM   차종 하나를 자세히
 *   npx tsx scripts/parts-audit.ts --samples  사장님이 눈으로 보실 표본 20건
 *
 * 사장님 지시(2026-09-05):
 * 「배터리나 부품도 조사가 더 필요할 수도 있음. 모델이 한정적으로 적혀 있을 수 있으며
 *  부품은 정확하게 그 차량에 적합한 것이 들어가야 하기 때문임. 예를 들어 소나타라도
 *  디젤 모델 가솔린 모델이나 엔진 유형에 따라 다른 것임.」
 *
 * 그래서 이 스크립트가 답해야 할 것은 넷이다:
 *   ① 차종·갈래마다 **후보가 몇 개**인가 — 후보가 둘 이상인 자리가 잘못 고르실 수 있는 자리다
 *   ② `engineNear` 가 그 후보를 **몇 %나 갈라 주는가**
 *   ③ **중복**(`(순정부품)` 짝)이 얼마나 되는가
 *   ④ **배터리**가 차종에 제대로 붙는가 — 안 붙으면 계획에서 뺀다
 *
 * 🔴 이 스크립트는 판단하지 않는다. 숫자를 내놓고 **사람이 보고 정한다.**
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface Gen {
  id: number;
  variant_key: string;
  proj_code: string;
  label: string;
  cars: number;
  /** 이 차의 제조사 — 수입차면 그 제조사 이름이 부품 글에 있는 게 정상이다 */
  maker: string;
  is_imported: boolean;
}

interface Part {
  id: number;
  category: string | null;
  name: string;
  part_no: string | null;
  fitment: string;
}

/** 경정비에서 실제로 갈아 끼우는 것들 — 이것들이 틀리면 차가 상한다 */
const CARE = ["오일필터", "에어필터", "에어컨필터", "연료필터", "브레이크패드"] as const;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main() {
  const only = arg("gen");
  const wantSamples = process.argv.includes("--samples");
  const { engineNear, oemPartNos, partDedupeKey, fitmentHasCode, foreignNear, fitConditions, whySnippet } =
    await import("../src/lib/parts-fit-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const gens = await sql<Gen[]>`
      SELECT g.id, g.variant_key, g.proj_code, g.label,
             mk.name_ko AS maker, mk.is_imported,
             (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id) AS cars
      FROM vehicle_generation g
      JOIN vehicle_model mo ON mo.id = g.model_id
      JOIN vehicle_maker mk ON mk.code = mo.maker_code
      WHERE g.proj_code IS NOT NULL AND btrim(g.proj_code) <> ''
      ORDER BY cars DESC`;

    const parts = await sql<Part[]>`
      SELECT p.id, p.category,
             COALESCE(NULLIF(btrim(p.display_name), ''), p.raw_name) AS name,
             p.part_no, p.fitment
      FROM product p
      WHERE p.is_active AND p.item_type = 'part'
        AND p.fitment IS NOT NULL AND btrim(p.fitment) <> ''`;

    console.log(`세대 ${gens.length}개 · 적용 차종이 적힌 부품 ${parts.length}개\n`);

    /* ── ① 후보 수와 ② 엔진 갈라짐 ─────────────────────────────── */
    let manyTotal = 0; // 후보가 둘 이상인 (세대 × 갈래) 자리
    let manySplit = 0; // 그중 엔진으로 갈라지는 자리
    let manyBlind = 0; // 그중 하나도 못 읽어 사장님이 그냥 고르셔야 하는 자리
    const foreignDropped: string[] = [];
    const rows: { label: string; cars: number; cells: string[] }[] = [];

    for (const g of gens) {
      if (only && g.variant_key !== only && g.proj_code !== only) continue;
      const raw = parts.filter((p) => fitmentHasCode(p.fitment, g.proj_code));
      const mine = raw.filter((p) => {
        const f = foreignNear(p.fitment, g.proj_code, g.maker);
        if (f) { foreignDropped.push(`${g.label} (${g.proj_code}, ${g.cars}대) ← ${f}: ${p.fitment.slice(0, 58)}`); return false; }
        return true;
      });
      if (mine.length === 0) continue;

      const cells: string[] = [];
      for (const cat of CARE) {
        const inCat = mine.filter((p) => p.category === cat);
        if (inCat.length === 0) {
          cells.push("–");
          continue;
        }
        /* 중복을 합친 뒤 세야 진짜 후보 수다 */
        const keys = new Set(inCat.map((p) => partDedupeKey(p.category, oemPartNos(p.fitment), p.name)));
        const n = keys.size;
        /* 갈래마다 갈리는 축이 다르다 — 엔진 · 앞뒤 · 인치를 다 본다 */
        const engines = new Set(
          inCat.map((p) => {
            const c = fitConditions(p.fitment, g.proj_code);
            const bits = [c.engine, c.axle, c.inch === null ? null : `${c.inch}인치`].filter(Boolean);
            return bits.length ? bits.join(" ") : "?";
          }),
        );
        const known = [...engines].filter((e) => e !== "?");
        if (n >= 2) {
          manyTotal++;
          if (known.length >= 2) manySplit++;
          else if (known.length === 0) manyBlind++;
        }
        cells.push(n === 1 ? "1" : `${n}${known.length >= 2 ? "✓" : known.length === 0 ? "✗" : "~"}`);
      }
      rows.push({ label: `${g.label} (${g.proj_code})`, cars: g.cars, cells: cells });
    }

    console.log("차종별 부품 후보 수  (✓ 엔진으로 갈림 · ~ 일부만 · ✗ 못 가름)");
    console.log(`  ${"차종".padEnd(26)}${"차".padStart(4)}  ${CARE.map((c) => c.padStart(7)).join("")}`);
    for (const r of rows.slice(0, only ? 200 : 25)) {
      console.log(`  ${r.label.slice(0, 24).padEnd(26)}${String(r.cars).padStart(4)}  ${r.cells.map((c) => c.padStart(7)).join("")}`);
    }
    if (!only && rows.length > 25) console.log(`  … 그 밖에 ${rows.length - 25}개 차종`);

    console.log(`\n🔴 후보가 둘 이상이라 **잘못 고르실 수 있는 자리: ${manyTotal}곳**`);
    console.log(`   그중 엔진으로 갈라지는 곳     ${manySplit}곳 (${pct(manySplit, manyTotal)})`);
    console.log(`   그중 엔진을 하나도 못 읽는 곳 ${manyBlind}곳 (${pct(manyBlind, manyTotal)}) ← 사장님이 그냥 고르셔야 함`);

    console.log(`
🔴 남의 차 부품이라 걸러낸 것: ${foreignDropped.length}건`);
    for (const f of foreignDropped.slice(0, 12)) console.log(`   ${f}`);

    /* ── ③ 중복 ────────────────────────────────────────────────── */
    const dupMap = new Map<string, Part[]>();
    for (const p of parts) {
      const k = partDedupeKey(p.category, oemPartNos(p.fitment), p.name);
      dupMap.set(k, [...(dupMap.get(k) ?? []), p]);
    }
    const dupGroups = [...dupMap.values()].filter((v) => v.length > 1);
    const dupExtra = dupGroups.reduce((s, v) => s + v.length - 1, 0);
    console.log(`\n중복: ${dupGroups.length}묶음 · 합치면 ${dupExtra}줄이 줄어듭니다 (전체 ${parts.length}줄 중)`);

    /* ── ④ 배터리가 차종에 붙나 ────────────────────────────────── */
    const batt = parts.filter((p) => p.category === "배터리");
    let battLinked = 0;
    const battGens = new Set<string>();
    for (const p of batt) {
      const hit = gens.filter((g) => fitmentHasCode(p.fitment, g.proj_code));
      if (hit.length) {
        battLinked++;
        for (const g of hit) battGens.add(g.proj_code);
      }
    }
    console.log(`\n배터리 ${batt.length}개 중 차종 코드가 적힌 것: ${battLinked}개 (${pct(battLinked, batt.length)})`);
    console.log(`   붙는 세대 ${battGens.size}개`);
    if (battLinked === 0) {
      console.log("   🔴 배터리는 차종에 못 붙습니다 — 계획에서 빼야 합니다");
    }
    console.log("   배터리 적용 차종 글 예시:");
    for (const p of batt.slice(0, 5)) console.log(`     ${p.name.slice(0, 26).padEnd(28)}${p.fitment.slice(0, 62)}`);

    /* ── 사장님이 눈으로 보실 표본 ─────────────────────────────── */
    if (wantSamples) {
      console.log("\n\n══════ 사장님 확인용 표본 20건 ══════");
      console.log("(이 부품이 정말 그 차·그 엔진 것이 맞는지 봐 주세요)\n");
      const picked: string[] = [];
      for (const g of gens.slice(0, 60)) {
        const mine = parts.filter(
          (p) => p.category === "오일필터" && fitmentHasCode(p.fitment, g.proj_code),
        );
        for (const p of mine.slice(0, 1)) {
          const e = engineNear(p.fitment, g.proj_code);
          const nos = oemPartNos(p.fitment);
          picked.push(
            `${g.label} (${g.proj_code}) — 손님 차 ${g.cars}대\n` +
              `   순정 품번  ${nos.length ? nos.join(" / ") : "(글에 없음)"}\n` +
              `   엔진      ${e ? `${e.label}  [${e.from}에서 읽음]` : "🔴 못 읽음 — 사장님이 고르셔야 함"}\n` +
              `   원문      ${p.fitment.slice(0, 100)}`,
          );
        }
        if (picked.length >= 20) break;
      }
      for (const s of picked) console.log(s + "\n");
    }
  } finally {
    await sql.end();
  }
}

function pct(a: number, b: number): string {
  return b === 0 ? "–" : `${Math.round((a / b) * 100)}%`;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
