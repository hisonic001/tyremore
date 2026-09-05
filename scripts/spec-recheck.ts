/**
 * 이미 쌓인 제원을 다시 검사해 **자동 확인**으로 올린다 (2026-09-05, 사장님 결정)
 *
 *   npx tsx scripts/spec-recheck.ts            몇 건이 통과하는지 보여만 준다
 *   npx tsx scripts/spec-recheck.ts --write    실제로 상태를 바꾼다
 *
 * 사장님: 「검수해야 할 것이 너무 많다 — 일정 수준의 교차검증이 통과되면 자동으로
 * 맞다고 해 달라. 나중에 작업하며 검증하면서 고쳐 나가겠다.」 (592건 전부 대기)
 *
 * 🔴 **자동확인은 「승인」이 아니다.** 값은 사장님께 다 열리지만 화면에는 다른 배지로
 *    보인다. 구별이 없으면 「고쳐 나가겠다」가 불가능하다 — 무엇을 봐야 할지 모른다.
 *
 * 무엇을 보고 통과시키나:
 *   ① 이미 저장될 때 `specFilter` 10단계를 통과한 값이다 (인용문 실재·범위·단위·모양)
 *   ② `crossCheckSpec` — 타이어↔휠 인치 아귀, 앞뒤 짝, 같은 제조사 이웃과의 거리
 * 하나라도 걸리면 **검수대기로 남겨** 사장님이 보신다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface Row {
  id: number;
  generation_id: number;
  variant_key: string;
  maker_code: string;
  group_no: number;
  item: string;
  text_value: string | null;
  num_min: string | null;
  unit: string | null;
  qualifier: { 위치?: string } | null;
  risk: string;
  status: string;
}

async function main() {
  const write = process.argv.includes("--write");
  const { crossCheckSpec } = await import("../src/lib/spec-verify");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const rows = await sql<Row[]>`
      SELECT s.id, s.generation_id, g.variant_key, m.maker_code, s.group_no, s.item,
             s.text_value, s.num_min::text AS num_min, s.unit, s.qualifier, s.risk, s.status
      FROM vehicle_spec s
      JOIN vehicle_generation g ON g.id = s.generation_id
      JOIN vehicle_model m ON m.id = g.model_id
      WHERE s.status = '검수대기'
      ORDER BY s.generation_id, s.group_no, s.item`;
    console.log(`검수대기 ${rows.length}건`);

    /** 같은 제조사·같은 항목의 가운데값 — 「이웃과 크게 튀나」를 볼 때 쓴다 */
    const neighbors = new Map<string, number[]>();
    for (const r of rows) {
      if (r.num_min === null) continue;
      const k = `${r.maker_code}|${r.item}|${r.unit ?? ""}`;
      neighbors.set(k, [...(neighbors.get(k) ?? []), Number(r.num_min)]);
    }
    const median = (a: number[]) => {
      if (a.length < 3) return null; // 이웃이 둘 이하면 가운데값이 뜻이 없다
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length / 2)];
    };

    /** 벌(그룹) 단위로 묶어 서로 아귀가 맞는지 본다 */
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.generation_id}|${r.group_no}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }

    const asRow = (r: Row) => ({
      item: r.item,
      textValue: r.text_value,
      numMin: r.num_min === null ? null : Number(r.num_min),
      unit: r.unit,
      where: r.qualifier?.위치 ?? null,
    });

    let pass = 0;
    let stay = 0;
    const byReason = new Map<string, number>();
    const byItem = new Map<string, { pass: number; stay: number }>();

    for (const r of rows) {
      const group = (groups.get(`${r.generation_id}|${r.group_no}`) ?? []).map(asRow);
      const med = median(neighbors.get(`${r.maker_code}|${r.item}|${r.unit ?? ""}`) ?? []);
      const res = crossCheckSpec(asRow(r), group, { neighborMedian: med });
      const t = byItem.get(r.item) ?? { pass: 0, stay: 0 };
      if (res.ok) {
        pass++;
        t.pass++;
        if (write) {
          await sql`
            UPDATE vehicle_spec
            SET status = '자동확인', auto_note = ${res.note}, updated_at = now()
            WHERE id = ${r.id} AND status = '검수대기'`;
        }
      } else {
        stay++;
        t.stay++;
        byReason.set(res.note, (byReason.get(res.note) ?? 0) + 1);
      }
      byItem.set(r.item, t);
    }

    console.log("\n항목별 (자동확인 / 남음)");
    for (const [item, t] of [...byItem].sort((a, b) => b[1].pass + b[1].stay - a[1].pass - a[1].stay)) {
      console.log(`   ${item.padEnd(24)} ${String(t.pass).padStart(4)} / ${t.stay}`);
    }
    if (byReason.size) {
      console.log("\n남는 이유");
      for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        console.log(`   ${n}건 — ${why}`);
      }
    }
    console.log(
      `\n자동확인 ${pass}건 · 사장님이 보실 것 ${stay}건${write ? " (바꿨습니다)" : " (미리보기 — 바꾸려면 --write)"}`,
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
