/**
 * 순정 제원 화면을 **글자로 미리 본다** — 읽기만 한다 (2026-09-05)
 *
 *   npx tsx scripts/spec-preview.ts MQ4          엔진 안 고른 상태
 *   npx tsx scripts/spec-preview.ts MQ4 디젤      디젤을 고른 상태
 *
 * 🔴 화면을 띄우지 않고도 **실제 DB 자료로** 어떻게 보이는지 확인하려고 만들었다.
 *    「벌이 둘인데 하나만 나온다」·「사라진 값이 있다」 같은 사고를 여기서 먼저 잡는다.
 *    맨 아랫줄의 「사라진 값 0개」가 이 도구의 핵심이다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const key = process.argv[2] ?? "MQ4";
  const { buildSpecSheet, shortQualifier } = await import("../src/lib/spec-sheet-core");
  const { fitConditions, foreignNear, oemPartNos, partDedupeKey, whySnippet, codeWordPattern } = await import(
    "../src/lib/parts-fit-core"
  );
  const { specItem, bothUnits } = await import("../src/lib/spec-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [g] = await sql<{ id: number; label: string; proj_code: string; maker: string; cars: number }[]>`
      SELECT g.id, g.label, g.proj_code, mk.name_ko AS maker,
             (SELECT count(*)::int FROM vehicle v WHERE v.generation_id=g.id) cars
      FROM vehicle_generation g JOIN vehicle_model mo ON mo.id=g.model_id
      JOIN vehicle_maker mk ON mk.code=mo.maker_code WHERE g.variant_key=${key}`;
    if (!g) { console.log("그런 차종이 없습니다: " + key); return; }
    const rows = await sql<any[]>`
      SELECT s.id, s.item, s.group_no, s.group_label, s.qualifier, s.num_min, s.num_max, s.unit,
             s.text_value, s.status, s.risk
      FROM vehicle_spec s WHERE s.generation_id=${g.id} AND s.status <> '거절' ORDER BY s.group_no, s.id`;
    const parts = await sql<any[]>`
      SELECT p.id, p.category, COALESCE(NULLIF(btrim(p.display_name),''),p.raw_name) name,
             p.part_no, p.fitment, p.list_price,
             COALESCE((SELECT sum(st.qty)::int FROM stock_item st WHERE st.product_id=p.id AND st.status='재고'),0) stock
      FROM product p WHERE p.is_active AND p.item_type='part' AND p.fitment IS NOT NULL
        AND p.fitment ~* ${codeWordPattern(g.proj_code)} ORDER BY p.category LIMIT 60`;

    const seen = new Set<string>();
    const fit = [] as any[];
    for (const r of parts) {
      if (foreignNear(r.fitment, g.proj_code, g.maker)) continue;
      const oemNos = oemPartNos(r.fitment);
      const k = partDedupeKey(r.category, oemNos, r.name);
      if (seen.has(k)) continue;
      seen.add(k);
      const c = fitConditions(r.fitment, g.proj_code);
      fit.push({ productId: Number(r.id), category: r.category, name: r.name, partNo: r.part_no,
        oemNos, engine: c.engine, axle: c.axle, inch: c.inch, why: whySnippet(r.fitment, g.proj_code),
        listPrice: r.list_price ? Number(r.list_price) : null, stock: Number(r.stock ?? 0) });
    }

    const sheetRows = rows.map((r) => {
      const def = specItem(r.item);
      const hidden = r.risk === "높음" && r.status !== "승인" && r.status !== "자동확인";
      const shown = hidden ? null : r.text_value ?? (r.num_min !== null && r.unit
        ? bothUnits(Number(r.num_min), r.num_max === null ? null : Number(r.num_max), r.unit) : null);
      return { id: Number(r.id), item: r.item, label: def?.label ?? r.item, shown, hidden,
        qualifier: r.qualifier ? Object.values(r.qualifier).join(" ") : null,
        groupNo: r.group_no, groupLabel: r.group_label, status: r.status };
    });

    const sheet = buildSpecSheet({ label: g.label, variantKey: key, cars: g.cars, rows: sheetRows, parts: fit, engine: process.argv[3] ?? null });
    console.log(`┌─ ${sheet.label} ${"─".repeat(Math.max(2, 30 - sheet.label.length))} 손님 차 ${sheet.cars}대 ─┐`);
    if (sheet.engines.length >= 2) console.log(`│ 엔진  ${sheet.engines.map((e) => `[${e}]`).join(" ")}`);
    for (const t of sheet.topics) {
      console.log(`├─ ${t.title} ${t.origin === "부품" ? "(우리 부품)" : ""} ${t.waitingIds.length ? `검수 ${t.waitingIds.length}` : t.autoIds.length ? "자동 확인" : ""}`);
      for (const s of t.sets) {
        if (s.title && sheet.setCount >= 2) console.log(`│  ▸ ${s.title}`);
        for (const l of s.lines) {
          if (l.kind === "없음") { console.log(`│    ${l.label.padEnd(16)} 자료 없음`); continue; }
          if (l.kind === "부품" && l.part) {
            const cond = [l.part.engine, l.part.axle, l.part.inch ? `${l.part.inch}인치` : null].filter(Boolean).join(" ");
            console.log(`│    ${l.label.padEnd(16)} ${(l.part.oemNos.join("/") || "품번없음").padEnd(24)} ${cond || "⚠ 조건 미상"}${l.part.stock ? `  재고${l.part.stock}` : ""}`);
            continue;
          }
          const v = l.values.map((x) => `${x.qualifier ? shortQualifier(x.qualifier) + " " : ""}${x.hidden ? "🔒가림" : x.shown}`).join(" · ");
          console.log(`│    ${l.label.padEnd(16)} ${v}${l.conflict ? "  ⚠어긋남" : ""}`);
        }
      }
      if (t.needsPick) console.log(`│    ⚠ 조건 못 읽은 부품 있음`);
      if (t.moreParts) console.log(`│    … 부품 ${t.moreParts}개 더`);
    }
    console.log(`└─ 값 ${sheetRows.length}개 · 사라진 값 ${sheet.dropped}개 · 벌 ${sheet.setCount}`);
  } finally { await sql.end(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
