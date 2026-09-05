/**
 * 순정 타이어 브랜드를 **이미 받아 둔 원문에서** 뽑아 넣는다 (2026-09-05, 사장님 요청)
 *
 *   npx tsx scripts/spec-brands.ts            무엇이 들어갈지 보여만 준다
 *   npx tsx scripts/spec-brands.ts --write    실제로 넣는다
 *
 * 🔴 새로 받아 올 것이 없다. 현대 자료실 PDF 「차량정보」 장에 「타이어 에너지 소비효율등급」
 *    표가 있고, 거기에 **제조사와 규격이 짝지어** 있다. 이미 `spec_source.body_text` 에
 *    저장돼 있었다 — 우리가 안 읽고 있었을 뿐이다.
 *
 * 🔴 **인용문은 저장된 원문의 줄을 글자 그대로** 쓴다. 격자를 다시 만들어 지어내면
 *    `specFilter` 의 「인용문이 원문에 있는가」 검사에 걸린다 — 그 검사가 이 시스템에서
 *    가장 중요한 안전장치다.
 *
 * 🔴 붙일 벌(그룹)을 못 찾으면 **버린다.** 어느 휠의 순정인지 모르는 브랜드는 쓸 데가 없고,
 *    엉뚱한 벌에 붙이면 사장님이 다른 규격을 순정으로 착각하신다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface Src {
  id: number;
  generation_id: number;
  title: string;
  body_text: string;
  variant_key: string;
}

async function main() {
  const write = process.argv.includes("--write");
  const { parseTireLabelTable } = await import("../src/lib/spec-manual");
  const { specItem } = await import("../src/lib/spec-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const srcs = await sql<Src[]>`
      SELECT s.id, s.generation_id, s.title, s.body_text, g.variant_key
      FROM spec_source s JOIN vehicle_generation g ON g.id = s.generation_id
      WHERE s.body_text ~* '타이어\\s*제조사'
      ORDER BY s.id`;
    console.log(`「타이어 제조사」 표가 있는 원문 ${srcs.length}건`);

    let found = 0;
    let saved = 0;
    let dropped = 0;

    for (const src of srcs) {
      /* 저장된 원문은 격자를 편 글자다 — 줄을 「|」로 쪼개 격자로 되돌린다 */
      const lines = src.body_text.split("\n").filter((l) => l.includes("|"));
      const cells = lines.map((l) => l.split("|").map((c) => c.trim()));
      const width = Math.max(...cells.map((c) => c.length), 0);
      const grid = {
        cells: cells.map((c) => [...c, ...Array(Math.max(0, width - c.length)).fill("")]),
        headRows: 1,
      };
      const got = parseTireLabelTable(grid as never);
      if (got.length === 0) continue;

      /* 이 세대에 이미 들어 있는 타이어 규격 → 벌 번호 */
      const sizes = await sql<{ group_no: number; group_label: string | null; text_value: string }[]>`
        SELECT group_no, group_label, text_value FROM vehicle_spec
        WHERE generation_id = ${src.generation_id} AND item = 'tire_size' AND text_value IS NOT NULL`;
      /** 「P235/60R18」과 「235/60R18」이 같은 규격이 되게 — 접두사를 떼고 견준다 */
      const sizeKey = (v: string) => v.replace(/\s/g, "").toUpperCase().replace(/^\(?P\)?|^LT/, "");
      const groupOf = new Map<string, { no: number; label: string | null }>();
      for (const s of sizes) {
        groupOf.set(sizeKey(s.text_value), { no: s.group_no, label: s.group_label });
      }

      console.log(`\n── ${src.variant_key} (${src.title})`);
      for (const b of got) {
        found++;
        const key = sizeKey(b.groupLabel ?? "");
        const g = groupOf.get(key);
        if (!g) {
          dropped++;
          console.log(`   ⚠️ ${b.textValue} ↔ ${b.groupLabel} — 이 규격의 벌이 없어 버립니다`);
          continue;
        }
        /* 🔴 인용문은 원문의 줄 그대로 — 브랜드와 규격이 둘 다 든 줄을 찾는다 */
        const quote = lines.find(
          (l) => l.includes(b.textValue!.split("(")[0].trim()) && l.replace(/\s/g, "").toUpperCase().includes(key),
        );
        if (!quote) {
          dropped++;
          console.log(`   ⚠️ ${b.textValue} ↔ ${b.groupLabel} — 원문 줄을 못 찾아 버립니다`);
          continue;
        }
        /* 🔴 두 번 돌려도 값이 두 벌 쌓이지 않게 — G80 에서 실제로 겪은 사고다 */
        const [dup] = await sql<{ id: number }[]>`
          SELECT id FROM vehicle_spec
          WHERE generation_id = ${src.generation_id} AND item = 'oe_tire_brand'
            AND group_no = ${g.no} AND text_value = ${b.textValue!}
          LIMIT 1`;
        if (dup) {
          console.log(`   (이미 있음) ${b.textValue} ↔ ${g.label ?? b.groupLabel}`);
          continue;
        }
        console.log(`   ${b.textValue} ↔ ${g.label ?? b.groupLabel} (벌 ${g.no})`);
        if (!write) continue;

        const [row] = await sql<{ id: number }[]>`
          INSERT INTO vehicle_spec
            (generation_id, group_no, group_label, item, qualifier, text_value, status, risk, created_by)
          VALUES (${src.generation_id}, ${g.no}, ${g.label ?? b.groupLabel ?? null}, 'oe_tire_brand',
                  ${sql.json({ 규격: b.groupLabel })}, ${b.textValue}, '검수대기',
                  ${specItem("oe_tire_brand")?.risk ?? "낮음"}, '설명서옮김')
          RETURNING id`;
        await sql`
          INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
          VALUES (${row.id}, ${src.id}, ${quote}, ${Math.max(0, src.body_text.indexOf(quote))})
          ON CONFLICT (spec_id, source_id) DO NOTHING`;
        saved++;
      }
    }

    console.log(
      `\n찾은 짝 ${found}개 · ${write ? `넣은 것 ${saved}개` : "미리보기 (넣으려면 --write)"} · 버린 것 ${dropped}개`,
    );
  } finally {
    await sql.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
