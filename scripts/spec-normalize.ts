/**
 * 이미 들어 있는 값들을 **정본 표기로 맞춘다** (2026-09-08, 사장님 지시)
 *
 *   npx tsx scripts/spec-normalize.ts            무엇이 어떻게 바뀌는지 보여만 준다
 *   npx tsx scripts/spec-normalize.ts --write    실제로 바꾼다
 *
 * 사장님: 「이미 들어 있는 값 602건도 같은 표기로 맞춰 주기 — 원문은 그대로 둘.」
 *
 * 🔴 **`text_value` 만 바꾸고 `spec_citation.quote` 는 손대지 않는다.**
 *    인용문은 「이 값이 저 줄에서 나왔다」는 증거다. 증거를 고치면 검수가 뜻을 잃는다.
 *
 * 🔴 **정본으로 못 바꾸는 값은 바꾸지 않고 목록으로 뽑는다.**
 *    조용히 고치면 틀린 값이 깨끗해 보이기만 한다 — 그게 가장 나쁘다.
 *
 * 🔴 숫자 값은 **손대지 않는다.** 숫자는 표기가 갈릴 일이 없고(단위는 이미 정규화돼 있다),
 *    반올림하면 원문과 달라진다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface Row {
  id: number;
  item: string;
  text_value: string;
  variant_key: string;
  label: string;
  body_type: string | null;
}

async function main() {
  const write = process.argv.includes("--write");
  const { canonical } = await import("../src/lib/spec-format-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const rows = await sql<Row[]>`
      SELECT s.id, s.item, s.text_value, g.variant_key, g.label, g.body_type
      FROM vehicle_spec s
      JOIN vehicle_generation g ON g.id = s.generation_id
      WHERE s.text_value IS NOT NULL AND btrim(s.text_value) <> '' AND s.status <> '거절'
      ORDER BY s.item, s.id`;
    console.log(`글자 값 ${rows.length}건을 봅니다\n`);

    const changed: { row: Row; to: string }[] = [];
    const same: string[] = [];
    const stuck: { row: Row; why: string }[] = [];

    for (const r of rows) {
      const made = canonical(r.item, r.text_value, null, { bodyType: r.body_type });
      if (!made.ok) {
        stuck.push({ row: r, why: made.why ?? "" });
        continue;
      }
      if (made.textValue === r.text_value) {
        same.push(r.item);
        continue;
      }
      changed.push({ row: r, to: made.textValue! });
    }

    if (changed.length) {
      console.log(`바뀔 것 ${changed.length}건:`);
      const byItem = new Map<string, { from: string; to: string; n: number }[]>();
      for (const c of changed) {
        const list = byItem.get(c.row.item) ?? [];
        const hit = list.find((x) => x.from === c.row.text_value && x.to === c.to);
        if (hit) hit.n++;
        else list.push({ from: c.row.text_value, to: c.to, n: 1 });
        byItem.set(c.row.item, list);
      }
      for (const [item, list] of byItem) {
        console.log(`  ── ${item}`);
        for (const x of list.sort((a, b) => b.n - a.n).slice(0, 12)) {
          console.log(`     「${x.from}」 → 「${x.to}」${x.n > 1 ? `  ×${x.n}` : ""}`);
        }
        if (list.length > 12) console.log(`     … 그 밖에 ${list.length - 12}가지`);
      }
    } else {
      console.log("바뀔 것이 없습니다");
    }

    if (stuck.length) {
      console.log(`\n🔴 정본으로 못 바꾼 것 ${stuck.length}건 — **바꾸지 않았습니다.** 사장님이 보셔야 합니다:`);
      for (const s of stuck.slice(0, 25)) {
        console.log(`   ${s.row.label.slice(0, 16).padEnd(18)}${s.row.item.padEnd(22)}「${s.row.text_value.slice(0, 40)}」`);
        console.log(`      ${s.why}`);
      }
      if (stuck.length > 25) console.log(`   … 그 밖에 ${stuck.length - 25}건`);
    }

    console.log(`\n그대로 둘 것 ${same.length}건 · 바꿀 것 ${changed.length}건 · 못 바꾼 것 ${stuck.length}건`);

    if (!write) {
      console.log("\n미리보기입니다. 실제로 바꾸려면 --write");
      return;
    }

    let n = 0;
    for (const c of changed) {
      /* 🔴 text_value 만 — 인용문(spec_citation.quote)은 건드리지 않는다 */
      await sql`UPDATE vehicle_spec SET text_value = ${c.to}, updated_at = now() WHERE id = ${c.row.id}`;
      n++;
    }
    console.log(`\n${n}건을 정본 표기로 바꿨습니다. 인용문은 하나도 안 건드렸습니다.`);
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
