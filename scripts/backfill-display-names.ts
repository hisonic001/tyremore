/**
 * ⭐ 품목 표시 이름 일괄 정리 (사장님 승인 2026-08-08 — "우선 1,2단계 진행해줘")
 *
 * 타이어 10,500여 개의 표시 이름이 세 갈래(MARS 원문·금호 목록·손 등록)에서 와서
 * 형식이 제각각이었다. 파서(parseTireName→cleanTireName)가 만든 표준 이름을
 * **비어 있는 display_name 에만** 채운다.
 *
 * 🔴 지키는 것:
 *   · raw_name(MARS 입력용 원문)은 절대 안 건드린다
 *   · 사장님이 이미 채운 display_name 은 보존
 *   · OE 마킹은 이름에 포함 — 같은 모델이 OE 로 구분되는 경우가 있다 (사장님 2026-08-08)
 *   · 같은 브랜드·규격에서 이름이 겹치면 XL·런플랫·흡음재 등 구분 표기를 덧붙이고,
 *     그래도 겹치면 하중속도까지, 그래도 겹치면 **채우지 않는다** (다른 상품이
 *     같은 이름이 되는 것보다 원문이 낫다)
 *   · 실행 전에 기존 display_name 전체를 tyremore-data 에 백업(JSON) — 되돌리기 가능
 *
 *   npx tsx scripts/backfill-display-names.ts          ← 미리보기 (안 바꿈)
 *   npx tsx scripts/backfill-display-names.ts --apply  ← 실제 적용
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const { parseTireName, cleanTireName } = await import("../src/lib/tire-name");

  const rows = await sql<
    { id: number; raw: string; pattern: string | null; disp: string | null; w: number | null; ar: number | null; rim: string | null; bc: string | null }[]
  >`
    SELECT id, raw_name raw, pattern, display_name disp,
           width w, aspect_ratio ar, rim_inch rim, brand_code bc
    FROM product WHERE item_type = 'tire' ORDER BY id`;

  // 되돌리기용 백업 — 지금의 display_name 상태 전부
  const backupPath = path.resolve(process.cwd(), "..", "tyremore-data", `display-name-백업-${new Date().toISOString().slice(0, 10)}.json`);
  if (APPLY) {
    writeFileSync(backupPath, JSON.stringify(rows.map((r) => ({ id: r.id, display_name: r.disp })), null, 1), "utf8");
    console.log(`백업 저장: ${backupPath}`);
  }

  type Cand = { id: number; name: string; extra: string; loadSpeed: string | null };
  const targets: Cand[] = [];
  let kept = 0;
  for (const r of rows) {
    if (r.disp?.trim()) {
      kept++;
      continue; // 사장님이 채운 것은 보존
    }
    const n = parseTireName(r.raw, r.pattern, { width: r.w, aspectRatio: r.ar, rimInch: r.rim, brandCode: r.bc });
    const base = cleanTireName(n);
    if (!base) continue;
    // 겹칠 때 덧붙일 구분 표기 — XL·런플랫·흡음재·저연비 등 (OE 는 이미 이름에 있다)
    const extra = n.badges
      .filter((b) => b.kind !== "oe")
      .map((b) => b.code)
      .join(" ");
    targets.push({ id: r.id, name: base, extra, loadSpeed: n.loadSpeed });
  }

  // 같은 브랜드·규격 안에서 이름이 겹치는 상품 찾기 (상품이 다른데 이름이 같으면 안 된다)
  const keyOf = (r: (typeof rows)[number]) => `${r.bc}|${r.w}|${r.ar}|${r.rim}`;
  const specOf = new Map(rows.map((r) => [r.id, keyOf(r)]));
  const finalName = new Map<number, string>();
  for (const t of targets) finalName.set(t.id, t.name);

  const enrich = (mk: (t: Cand) => string, label: string) => {
    const groups = new Map<string, number[]>();
    for (const t of targets) {
      const k = `${specOf.get(t.id)}|${finalName.get(t.id)!.toUpperCase()}`;
      groups.set(k, [...(groups.get(k) ?? []), t.id]);
    }
    let touched = 0;
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const t = targets.find((x) => x.id === id)!;
        const next = mk(t).replace(/\s{2,}/g, " ").trim();
        if (next && next !== finalName.get(id)) {
          finalName.set(id, next);
          touched++;
        }
      }
    }
    if (touched) console.log(`이름 겹침 → ${label} 덧붙임: ${touched}개`);
  };
  enrich((t) => `${finalName.get(t.id)} ${t.extra}`, "구분 표기(XL 등)");
  enrich((t) => `${finalName.get(t.id)} ${t.loadSpeed ?? ""}`, "하중속도");

  // 끝까지 겹치는 것은 채우지 않는다
  const still = new Map<string, number[]>();
  for (const t of targets) {
    const k = `${specOf.get(t.id)}|${finalName.get(t.id)!.toUpperCase()}`;
    still.set(k, [...(still.get(k) ?? []), t.id]);
  }
  const skip = new Set<number>();
  for (const ids of still.values()) if (ids.length > 1) for (const id of ids) skip.add(id);

  const updates = targets.filter((t) => !skip.has(t.id));
  console.log(`대상 ${targets.length}개 · 채움 ${updates.length}개 · 보존(기존 지정) ${kept}개 · 겹쳐서 건너뜀 ${skip.size}개`);
  console.log("\n표본 12개:");
  for (const t of updates.slice(0, 12)) console.log(`  #${t.id} → ${finalName.get(t.id)}`);

  if (!APPLY) {
    console.log("\n(미리보기였습니다 — 적용하려면 --apply)");
  } else {
    const CHUNK = 1000;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const part = updates.slice(i, i + CHUNK);
      await sql`
        UPDATE product p SET display_name = v.name
        FROM (SELECT unnest(${part.map((t) => t.id)}::bigint[]) AS id,
                     unnest(${part.map((t) => finalName.get(t.id)!)}::text[]) AS name) v
        WHERE p.id = v.id AND NULLIF(p.display_name, '') IS NULL
      `;
      console.log(`적용 ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
    }
    console.log("✅ 끝 — 되돌리기는 백업 JSON 으로 가능합니다");
  }
  await sql.end();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
