/**
 * 이미 쪼개져 들어간 스태거드를 한 벌로 합친다 (2026-09-05, 사장님 지적)
 *
 *   npx tsx scripts/spec-fix-staggered.ts            무엇이 합쳐질지 보여만 준다
 *   npx tsx scripts/spec-fix-staggered.ts --write    실제로 합친다
 *
 * 🔴 무엇이 잘못됐었나: 표를 읽을 때 **행 머리의 「전륜/후륜」을 안 봐서**, G80(RG3)의
 *    19인치 앞 `245/45R19` 와 뒤 `275/40R19` 가 **별개 두 벌**로 들어갔다.
 *    화면에서는 「19인치 옵션이 두 개」로 보인다. 사장님이 이걸 짚어 주셨다.
 *
 * 🔴 **확실할 때만 합친다.** 세 조건이 전부 맞아야 한다:
 *      ① 림 인치가 같다 (19 == 19)
 *      ② 폭이 다르다 (245 ≠ 275)
 *      ③ 두 벌의 공기압 「위치」가 앞·뒤로 정확히 갈린다
 *    하나라도 어긋나면 **손대지 않는다.** 진짜로 「19인치 옵션이 둘」인 차를 뭉개면
 *    사장님이 화면에서 무엇을 끼워야 할지 알 수 없게 된다 — 그게 더 큰 사고다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

interface Row {
  id: number;
  generation_id: number;
  variant_key: string;
  group_no: number;
  group_label: string | null;
  item: string;
  text_value: string | null;
  qualifier: { 위치?: string } | null;
}

async function main() {
  const write = process.argv.includes("--write");
  const { tireRimInch, looksLikeTireSize } = await import("../src/lib/spec-core");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const rows = await sql<Row[]>`
      SELECT s.id, s.generation_id, g.variant_key, s.group_no, s.group_label,
             s.item, s.text_value, s.qualifier
      FROM vehicle_spec s JOIN vehicle_generation g ON g.id = s.generation_id
      WHERE s.item IN ('tire_size','tire_pressure','wheel_size')
      ORDER BY s.generation_id, s.group_no`;

    /* 세대 → 벌번호 → 그 벌의 줄들 */
    const byGen = new Map<number, Map<number, Row[]>>();
    for (const r of rows) {
      const g = byGen.get(r.generation_id) ?? new Map<number, Row[]>();
      g.set(r.group_no, [...(g.get(r.group_no) ?? []), r]);
      byGen.set(r.generation_id, g);
    }

    let pairs = 0;
    let moved = 0;
    for (const [, groups] of byGen) {
      /** 벌 하나를 요약한다 — 규격·인치·폭·공기압 위치 */
      const info = new Map<number, { size: string; rim: number; width: number; where: Set<string>; key: string }>();
      for (const [no, list] of groups) {
        const size = list.find((r) => r.item === "tire_size")?.text_value ?? "";
        if (!looksLikeTireSize(size)) continue;
        const rim = tireRimInch(size);
        if (rim === null) continue;
        const width = Number(/(\d{3})\//.exec(size.replace(/\s/g, ""))?.[1] ?? 0);
        const where = new Set(
          list
            .filter((r) => r.item === "tire_pressure" && r.qualifier?.위치)
            .map((r) => r.qualifier!.위치!),
        );
        info.set(no, { size, rim, width, where, key: list[0].variant_key });
      }

      /* 같은 인치끼리 짝을 본다 */
      const byRim = new Map<number, number[]>();
      for (const [no, v] of info) byRim.set(v.rim, [...(byRim.get(v.rim) ?? []), no]);

      for (const [rim, nos] of byRim) {
        if (nos.length !== 2) continue; // 딱 두 벌일 때만 — 셋이면 사람이 봐야 한다
        const [a, b] = nos.map((n) => info.get(n)!);
        const [na, nb] = nos;
        if (a.width === b.width) continue; // ② 폭이 같으면 스태거드가 아니다
        /* ③ 한쪽이 앞만, 다른 쪽이 뒤만 가리켜야 한다 */
        const aFront = a.where.has("앞") && !a.where.has("뒤");
        const bRear = b.where.has("뒤") && !b.where.has("앞");
        const aRear = a.where.has("뒤") && !a.where.has("앞");
        const bFront = b.where.has("앞") && !b.where.has("뒤");
        const ok = (aFront && bRear) || (aRear && bFront);
        if (!ok) continue;

        const frontNo = aFront ? na : nb;
        const rearNo = aFront ? nb : na;
        const front = info.get(frontNo)!;
        const rear = info.get(rearNo)!;
        const label = `${rim}인치 (앞 ${front.size} · 뒤 ${rear.size})`;
        pairs++;
        console.log(`${front.key}: 벌 ${frontNo}(앞 ${front.size}) + 벌 ${rearNo}(뒤 ${rear.size}) → ${label}`);

        if (!write) continue;
        /* 뒤 벌을 앞 벌 번호로 옮기고, 규격·휠에도 위치를 붙인다 */
        for (const [no, pos] of [
          [frontNo, "앞"],
          [rearNo, "뒤"],
        ] as [number, string][]) {
          const list = groups.get(no) ?? [];
          for (const r of list) {
            const q = { ...(r.qualifier ?? {}), 위치: r.qualifier?.위치 ?? pos };
            await sql`
              UPDATE vehicle_spec
              SET group_no = ${frontNo}, group_label = ${label},
                  qualifier = ${sql.json(q)}, updated_at = now()
              WHERE id = ${r.id}`;
            moved++;
          }
        }
      }
    }

    console.log(`\n스태거드 짝 ${pairs}쌍${write ? ` · 값 ${moved}개를 한 벌로 옮겼습니다` : " (미리보기 — 실제로 합치려면 --write)"}`);
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
