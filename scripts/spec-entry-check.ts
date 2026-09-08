/**
 * 사장님 입력 경로를 **실제 DB 에 넣어 보고 되돌린다** (2026-09-08)
 *
 *   npx tsx scripts/spec-entry-check.ts
 *
 * 🔴 타입 검사와 빌드는 **SQL 이 맞는지 못 본다.** 2026-09-05 에 `id = ANY(...)` 배열 질의가
 *    배포된 뒤에야 터졌다. 그래서 넣는 길은 **진짜 표에 한 번 넣어 보고** 되돌려 확인한다.
 *
 * 🔴 트랜잭션 안에서만 하고 **반드시 되돌린다.** 실제 자료를 건드리지 않는다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { canonical } = await import("../src/lib/spec-format-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const [gen] = await sql<{ id: number; label: string; body_type: string | null }[]>`
      SELECT id, label, body_type FROM vehicle_generation WHERE variant_key = 'IG' LIMIT 1`;
    if (!gen) {
      console.log("그랜저 IG 세대를 못 찾았습니다");
      return;
    }
    const [who] = await sql<{ id: number }[]>`SELECT id FROM app_user ORDER BY id LIMIT 1`;
    console.log(`시험 차종: ${gen.label} (id ${gen.id}, 차체 ${gen.body_type ?? "모름"})`);

    /* 사장님이 칠 법한 것들 — 일부러 지저분하게 */
    const lines = [
      { item: "tire_size", raw: "235/45 r18" },
      { item: "wheel_size", raw: "7.5j x 18" },
      { item: "tire_pressure", raw: "35" },
      { item: "wheel_nut_torque", raw: "11~13", unit: "kgf·m" },
      { item: "engine_oil_viscosity", raw: "5w30" },
      { item: "battery_size", raw: "agm 80l" },
      { item: "battery_position", raw: "엔진룸" },
      { item: "wiper_size", raw: "650", qualifier: "운전석" },
      { item: "wiper_size", raw: "450", qualifier: "조수석" },
      /* 🔴 이건 막혀야 한다 */
      { item: "wheel_nut_torque", raw: "110", unit: "kgf·m" },
    ];

    console.log("\n정본으로 바꾸기:");
    const good: { item: string; made: ReturnType<typeof canonical>; qualifier?: string }[] = [];
    for (const l of lines) {
      const made = canonical(l.item, l.raw, (l as { unit?: string }).unit, { bodyType: gen.body_type });
      console.log(
        `   ${l.item.padEnd(22)}「${l.raw}」 → ${made.ok ? `✓ ${made.display}` : `✖ ${made.why}`}`,
      );
      if (made.ok) good.push({ item: l.item, made, qualifier: (l as { qualifier?: string }).qualifier });
    }

    /* ── 진짜로 넣어 보고 되돌린다 ── */
    console.log("\n실제 DB 에 넣어 보는 중 (끝나면 되돌립니다)…");
    await sql.begin(async (tx) => {
      const bodyText = good.map((g) => `${g.item} ${g.made.display}`).join("\n");
      const [src] = await tx<{ id: number }[]>`
        INSERT INTO spec_source (generation_id, url, host, kind, trust_rank, independence_key,
                                 title, body_text, requested_by)
        VALUES (${gen.id}, ${"사장님입력:시험"}, '사장님', '사장님입력', 2, 'owner:시험',
                '시험', ${bodyText}, ${who?.id ?? 1})
        ON CONFLICT (url, fetched_on) DO UPDATE SET body_text = EXCLUDED.body_text
        RETURNING id`;
      console.log("   spec_source 넣음 id=" + src.id);

      for (const g of good) {
        const [row] = await tx<{ id: number }[]>`
          INSERT INTO vehicle_spec
            (generation_id, group_no, item, qualifier, text_value, num_min, num_max, unit,
             status, risk, created_by, verified_by, verified_at)
          VALUES (${gen.id}, 90, ${g.item},
                  ${g.qualifier ? tx.json({ 위치: g.qualifier }) : null},
                  ${g.made.textValue}, ${g.made.numMin}, ${g.made.numMax}, ${g.made.unit},
                  '승인', '보통', '사장님입력', ${who?.id ?? 1}, now())
          RETURNING id`;
        await tx`
          INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
          VALUES (${row.id}, ${src.id}, ${`사장님이 시험에서 보고 넣음 — ${g.made.display}`}, 0)
          ON CONFLICT (spec_id, source_id) DO NOTHING`;
      }
      console.log(`   vehicle_spec ${good.length}줄 + 인용 ${good.length}줄 넣음`);

      /* 넣은 것이 화면에 어떻게 보일지 그대로 읽어 본다 */
      const back = await tx<{ item: string; text_value: string | null; num_min: string | null; unit: string | null; q: string | null }[]>`
        SELECT item, text_value, num_min::text AS num_min, unit, qualifier->>'위치' AS q
        FROM vehicle_spec WHERE generation_id = ${gen.id} AND created_by = '사장님입력'
        ORDER BY item`;
      console.log("\n   다시 읽어 본 것:");
      for (const r of back) {
        console.log(`     ${r.item.padEnd(22)}${r.text_value ?? `${r.num_min} ${r.unit}`}${r.q ? ` (${r.q})` : ""}`);
      }

      throw new Error("__되돌리기__");
    }).catch((e) => {
      if (String(e).includes("__되돌리기__")) return;
      throw e;
    });

    /* 정말 되돌아갔나 */
    const [left] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM vehicle_spec WHERE created_by = '사장님입력'`;
    console.log(`\n되돌린 뒤 남은 시험 자료: ${left.n}줄 ${left.n === 0 ? "✓ 깨끗합니다" : "🔴 남았습니다!"}`);
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
