/**
 * 차종·세대 씨앗 (D-04 3차 개정, 2026-09-03)
 *
 * 🔴 새 코드 체계를 발명하지 않는다. **사장님이 5년간 손으로 쳐 오신 괄호 안 글자**
 *    (`쏘렌토(MQ4)` 의 MQ4) 가 곧 제조사 취급설명서 주소의 projCode 다.
 *
 * 🔴 **이름이 아니라 코드가 신원이다.** 실측으로 같은 차가 이렇게 적혀 있다:
 *      포터2(HR) 88대 · 포터 Ⅱ (HR) 2대 · 포터(HR) 2WD 2대
 *      그랜저(IG) 37대 · 그렌져(IG) 1대 · 그랜저9(IG) HEV 1대
 *      G80(DH) 27대 · 제네시스(DH) 5대      ← 제네시스 DH 가 G80 으로 이름만 바뀐 차다
 *    이름으로 묶으면 갈라지고, 코드로 묶으면 하나가 된다.
 *
 * 🔴 **연식으로 세대를 짐작하지 않는다.** `싼타페(TM)` 에 2009년 차가, `모닝(JA)` 에
 *    2009년 차가 들어 있다. 괄호가 없는 것(그냥 `쏘렌토` 43대)은 비워 둔다.
 *    억지로 채우면 그 순간 43대가 전부 틀린 제원을 갖는다.
 *
 * 🔴 **동력과 고성능은 갈라야 한다.** 하이브리드는 엔진오일 용량이 다르고,
 *    `아반떼N` 은 타이어가 245/35R19 로 일반 아반떼(205/55R16)와 아예 다르다.
 *      그랜저 HEV (IG) → IG-HEV      아반떼N (CN7 N) → CN7-N
 *    괄호 밖 이름에 적힌 HEV 도 읽어야 한다 — 사장님은 양쪽 다 쓰신다.
 *
 *   npx tsx scripts/seed-vehicle-generation.ts           어떻게 묶이는지만 보여준다
 *   npx tsx scripts/seed-vehicle-generation.ts --write   실제로 넣는다
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

/* ------------------------------------------------------------------ */
/* 괄호 안 글자가 세대코드인가                                          */
/* ------------------------------------------------------------------ */

/**
 * 실제 자료의 진짜 코드: HR · IG · TAM · TQ · LX2 · DN8 · YP · DH · TM · MQ4 · GN7 · NX4
 * 실제 자료의 가짜 코드: 1.2,1.4ton · 2WD · FWD/AWD · 그랜드 · 166 · 212K
 */
const NOT_CODE = new Set([
  "2WD", "4WD", "AWD", "FWD", "RWD", "2H", "4H",
  "MT", "AT", "DCT", "CVT",
  "LWB", "SWB", "롱바디", "숏바디", "킹캡", "더블캡", "초장축", "장축", "단축",
  "승합", "화물", "밴", "특장", "캠핑카", "그랜드",
  "가솔린", "디젤", "LPG", "LPI", "전기", "하이브리드", "HEV", "PHEV", "EV", "수소", "FCEV",
  "터보", "TURBO", "GDI", "TCI", "CRDI",
  "신형", "구형", "중고", "미상",
]);

function looksLikeProjCode(raw: string): boolean {
  const s = raw.trim().toUpperCase();
  if (!s || s.length > 6) return false;
  if (NOT_CODE.has(s)) return false;
  /* 톤수·인승·도어·배기량·구분기호는 코드가 아니다 */
  if (/톤|TON|인승|도어|CC|리터|[.,/]/.test(s)) return false;
  /* 영문 대문자로 시작하고 영문·숫자만 — 한글이 섞이면 코드가 아니다 */
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(s)) return false;
  /* 벤츠 `(166)` 처럼 숫자만인 것은 여기서 이미 걸린다 (영문 시작을 요구했다) */
  return true;
}

/* ------------------------------------------------------------------ */
/* 동력·고성능                                                         */
/* ------------------------------------------------------------------ */

/** 🔴 괄호 안이든 밖이든 **줄 전체**를 본다 — `그랜저 HEV (IG)` 는 괄호 밖에 적혀 있다 */
function powertrainOf(s: string): string | null {
  const t = s.toUpperCase();
  if (/\bPHEV\b|플러그인/.test(t)) return "PHEV";
  if (/\bHEV\b|하이브리드|\bHYBRID\b/.test(t)) return "하이브리드";
  if (/\bEV\b|\bELECTRIC\b|전기차|(^|[^가-힣])전기($|[^가-힣])/.test(t)) return "전기";
  if (/\bLPG\b|\bLPI\b/.test(t)) return "LPG";
  if (/디젤|\bDIESEL\b/.test(t)) return "디젤";
  return null;
}

/**
 * 고성능 판: `아반떼N` 은 타이어가 아예 다른 차다. 붙여 쓰든 띄어 쓰든 잡는다.
 * 🔴 `N` 한 글자만 보고 잡으면 안 된다 — `NEXO`·`N LINE` 같은 게 걸린다.
 */
function performanceOf(raw: string): string | null {
  const t = raw.toUpperCase();
  if (/\bN\s?LINE\b|N라인/.test(t)) return null; // N 라인은 겉모습만 — 규격은 일반형과 같다
  if (/(^|[^A-Z])N($|[^A-Z가-힣])/.test(t.replace(/\(|\)/g, " "))) return "N";
  return null;
}

/* ------------------------------------------------------------------ */
/* 이름 다듬기                                                         */
/* ------------------------------------------------------------------ */

/** `포터 Ⅱ` · `포터II` · `포터 2` 를 같은 것으로 본다 */
function nameKeyOf(name: string): string {
  return name
    .replace(/[Ⅱ]|(?<![A-Za-z])II(?![A-Za-z])/g, "2")
    .replace(/[Ⅲ]|(?<![A-Za-z])III(?![A-Za-z])/g, "3")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * 이름에서 동력·구동·수식어를 떼어 낸다 — `그랜저 HEV` → `그랜저`
 * 🔴 앞뒤 경계를 반드시 본다. 경계가 없으면 `EV6` 가 `6` 이 되고,
 *    `아이오닉` 같은 이름도 조각날 수 있다. (실제로 EV6 가 「6」으로 들어갔었다)
 */
const NAME_NOISE =
  /(?<![A-Za-z0-9])(HEV|PHEV|EV|ELECTRIC|하이브리드|플러그인|가솔린|디젤|LPG|LPI|2WD|4WD|AWD|FWD|RWD|ALL\s?NEW|더\s?뉴|올\s?뉴|THE\s?NEW)(?![A-Za-z0-9])/gi;

function cleanName(name: string): string {
  return name.replace(NAME_NOISE, " ").replace(/\s+/g, " ").trim();
}

interface Parsed {
  raw: string;
  maker: string | null;
  name: string;
  code: string | null;
  inside: string | null;
  key: string | null;
  pt: string | null;
  cars: number;
  yMin: number | null;
  yMax: number | null;
}

function parseRow(r: { maker_code: string | null; model: string; n: number; y_min: number | null; y_max: number | null }): Parsed {
  const s = r.model.trim().replace(/[（]/g, "(").replace(/[）]/g, ")");
  const m = /^(.*?)\s*\(\s*([^)]+?)\s*\)\s*(.*)$/.exec(s);
  const head = m ? m[1].trim() : s;
  const inside = m ? m[2].trim() : null;
  const name = cleanName(head) || head;

  /* 🔴 동력·고성능은 줄 전체에서 읽는다 */
  const pt = powertrainOf(s);
  const perf = performanceOf(s);

  const codeTok = inside ? inside.split(/\s+/)[0] : null;
  const code = codeTok && looksLikeProjCode(codeTok) ? codeTok.toUpperCase() : null;

  let key: string | null = null;
  if (code) {
    const parts = [code];
    /* 디젤·LPG 는 제원이 갈리긴 해도 취급설명서가 한 권이라 코드가 같다 — 열쇠를 나누지 않는다 */
    if (pt === "하이브리드") parts.push("HEV");
    else if (pt === "PHEV") parts.push("PHEV");
    else if (pt === "전기") parts.push("EV");
    if (perf) parts.push(perf);
    key = parts.join("-");
  }
  return { raw: r.model, maker: r.maker_code, name, code, inside, key, pt, cars: r.n, yMin: r.y_min, yMax: r.y_max };
}

/* ------------------------------------------------------------------ */

async function main() {
  const write = process.argv.includes("--write");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    /* 🔴 maker_code 가 빈 줄도 가져온다 — 같은 코드의 다른 줄에서 제조사를 알아낼 수 있다 */
    const rows = await sql<
      { maker_code: string | null; model: string; n: number; y_min: number | null; y_max: number | null }[]
    >`
      SELECT v.maker_code, v.model, count(*)::int AS n,
             min(v.year)::int AS y_min, max(v.year)::int AS y_max
      FROM vehicle v
      WHERE v.model IS NOT NULL AND btrim(v.model) <> '' AND v.is_active
      GROUP BY 1, 2 ORDER BY 3 DESC`;

    const parsed = rows.map(parseRow);

    /**
     * ① 세대 열쇠별로 모아, **차가 가장 많은 표기를 정본 이름**으로 삼는다.
     *    포터2(88) vs 포터 Ⅱ(2) vs 포터(2) → 「포터2」
     *    제조사가 빈 줄은 같은 열쇠의 다른 줄에서 채운다.
     */
    interface Gen {
      key: string;
      code: string;
      pt: string | null;
      names: Map<string, number>;
      makers: Map<string, number>;
      cars: number;
      yMin: number | null;
      yMax: number | null;
    }
    const gens = new Map<string, Gen>();
    for (const p of parsed) {
      if (!p.key) continue;
      let g = gens.get(p.key);
      if (!g) {
        g = { key: p.key, code: p.code!, pt: p.pt, names: new Map(), makers: new Map(), cars: 0, yMin: null, yMax: null };
        gens.set(p.key, g);
      }
      g.names.set(p.name, (g.names.get(p.name) ?? 0) + p.cars);
      if (p.maker) g.makers.set(p.maker, (g.makers.get(p.maker) ?? 0) + p.cars);
      g.cars += p.cars;
      if (p.yMin !== null) g.yMin = g.yMin === null ? p.yMin : Math.min(g.yMin, p.yMin);
      if (p.yMax !== null) g.yMax = g.yMax === null ? p.yMax : Math.max(g.yMax, p.yMax);
    }

    const top = <T>(m: Map<T, number>): T | null =>
      [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    /** 정본 이름·제조사 */
    const canon = new Map<string, { name: string; maker: string }>();
    const noMaker: string[] = [];
    for (const g of gens.values()) {
      const maker = top(g.makers);
      if (!maker) {
        noMaker.push(g.key);
        continue;
      }
      canon.set(g.key, { name: top(g.names)!, maker });
    }

    /** ② 세대가 없는 줄은 이름만으로 차종을 만든다 (표기 흔들림은 nameKey 로 모은다) */
    const plainModels = new Map<string, { maker: string; name: string; cars: number }>();
    for (const p of parsed) {
      if (p.key && canon.has(p.key)) continue;
      if (!p.maker) continue;
      const k = `${p.maker}|${nameKeyOf(p.name)}`;
      const e = plainModels.get(k);
      if (e) {
        e.cars += p.cars;
        if (p.cars > 0 && p.name.length < e.name.length) e.name = p.name;
      } else plainModels.set(k, { maker: p.maker, name: p.name, cars: p.cars });
    }

    /* ------------------------- 보고 ------------------------- */
    const genCars = [...gens.values()].filter((g) => canon.has(g.key)).reduce((s, g) => s + g.cars, 0);
    const restCars = parsed.filter((p) => !p.key || !canon.has(p.key)).reduce((s, p) => s + p.cars, 0);
    console.log(`세대 ${canon.size}종 · 별칭 ${parsed.length}줄`);
    console.log(`  ✅ 세대가 정해지는 차량: ${genCars}대`);
    console.log(`  🔴 세대를 못 정해 비워 두는 차량: ${restCars}대`);
    if (noMaker.length) console.log(`  ⚠️ 제조사를 못 정한 코드: ${noMaker.join(", ")}`);

    console.log("\n가장 많은 세대 14종:");
    for (const g of [...gens.values()].filter((x) => canon.has(x.key)).sort((a, b) => b.cars - a.cars).slice(0, 14)) {
      const c = canon.get(g.key)!;
      const wide = g.yMin && g.yMax && g.yMax - g.yMin > 12 ? "  ⚠️연식폭넓음" : "";
      console.log(`  ${g.key.padEnd(9)} ${String(g.cars).padStart(3)}대  ${c.maker} ${c.name}  차량연식 ${g.yMin ?? "?"}~${g.yMax ?? "?"}${wide}`);
    }

    console.log("\n표기가 여럿이라 하나로 합친 것 (코드가 같으면 같은 차다):");
    let merged = 0;
    for (const g of [...gens.values()].sort((a, b) => b.cars - a.cars)) {
      if (g.names.size < 2 || !canon.has(g.key)) continue;
      merged++;
      if (merged > 8) continue;
      const list = [...g.names.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}(${c})`).join(" · ");
      console.log(`  ${g.key.padEnd(9)} → ${canon.get(g.key)!.name}   ←  ${list}`);
    }
    console.log(`  ... 모두 ${merged}건`);

    const rejected = parsed.filter((p) => p.inside && !p.code);
    if (rejected.length) {
      console.log(`\n괄호가 있어도 세대코드가 아니라 버린 것 ${rejected.length}줄 중 상위 6:`);
      for (const r of rejected.sort((a, b) => b.cars - a.cars).slice(0, 6)) {
        console.log(`  ${String(r.cars).padStart(3)}대  ${r.raw}   (괄호 안 「${r.inside}」)`);
      }
    }

    if (!write) {
      console.log("\n(미리보기입니다 — 실제로 넣으려면 --write)");
      return;
    }

    /* ------------------------- 넣기 ------------------------- */
    const modelId = new Map<string, number>();
    const ensureModel = async (maker: string, name: string): Promise<number> => {
      const k = `${maker}|${name}`;
      const hit = modelId.get(k);
      if (hit) return hit;
      await sql`INSERT INTO vehicle_model (maker_code, name_ko) VALUES (${maker}, ${name})
                ON CONFLICT (maker_code, name_ko) DO NOTHING`;
      const [m] = await sql<{ id: number }[]>`
        SELECT id FROM vehicle_model WHERE maker_code = ${maker} AND name_ko = ${name}`;
      modelId.set(k, m.id);
      return m.id;
    };

    for (const pm of plainModels.values()) await ensureModel(pm.maker, pm.name);

    const genId = new Map<string, number>();
    for (const g of gens.values()) {
      const c = canon.get(g.key);
      if (!c) continue;
      const mid = await ensureModel(c.maker, c.name);
      /**
       * 🔴 year_from/year_to 는 **그 세대가 실제로 생산된 기간**을 담는 칸이다.
       *    우리 차량 연식으로 채우면 안 된다 — `싼타페(TM)` 에 2009년 차가 있어서
       *    그대로 넣으면 「TM 은 2009년부터」라는 거짓말이 표에 박힌다.
       *    비워 두고 (나중에 취급설명서에서 채운다), 우리 차량 연식은 참고로 note 에만 적는다.
       */
      const note = g.yMin ? `우리 차량 연식 ${g.yMin}~${g.yMax} (${g.cars}대)` : null;
      const label = `${c.name} ${g.key.replace(/-/g, " ")}`;
      await sql`
        INSERT INTO vehicle_generation (model_id, variant_key, proj_code, powertrain, label, note)
        VALUES (${mid}, ${g.key}, ${g.code}, ${g.pt}, ${label}, ${note})
        ON CONFLICT (variant_key) DO UPDATE
          SET model_id = EXCLUDED.model_id, label = EXCLUDED.label, note = EXCLUDED.note`;
      const [row] = await sql<{ id: number }[]>`SELECT id FROM vehicle_generation WHERE variant_key = ${g.key}`;
      genId.set(g.key, row.id);
    }

    for (const p of parsed) {
      const c = p.key ? canon.get(p.key) : null;
      const mid = c
        ? await ensureModel(c.maker, c.name)
        : p.maker
          ? modelId.get(`${p.maker}|${plainModels.get(`${p.maker}|${nameKeyOf(p.name)}`)?.name ?? p.name}`) ?? null
          : null;
      const gid = p.key ? genId.get(p.key) ?? null : null;
      await sql`
        INSERT INTO vehicle_model_alias (raw_model, model_id, generation_id, matched_by)
        VALUES (${p.raw}, ${mid}, ${gid}, ${gid ? "괄호코드" : "이름만"})
        ON CONFLICT (raw_model) DO UPDATE
          SET model_id = EXCLUDED.model_id, generation_id = EXCLUDED.generation_id,
              matched_by = EXCLUDED.matched_by`;
    }

    const done = await sql<{ id: number }[]>`
      UPDATE vehicle v SET generation_id = a.generation_id
      FROM vehicle_model_alias a
      WHERE a.raw_model = v.model AND a.generation_id IS NOT NULL
        AND (v.generation_id IS NULL OR v.generation_id <> a.generation_id)
      RETURNING v.id`;
    console.log(`\n✅ 넣었습니다 — 차량 ${done.length}대에 세대를 붙였습니다`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
