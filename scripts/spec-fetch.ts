/**
 * 차종 하나의 순정 제원을 제조사 취급설명서에서 받아 온다 (2026-09-03)
 *
 * 🔴 **사람이 눌러야만 돈다.** 스스로 돌지 않는다. 한 번에 차종 하나.
 *    목차 한 장 + 제원 쪽 두어 장, 사이에 쉬면서 받는다. 긁지 않는다.
 * 🔴 들어간 값은 전부 `검수대기` 다. 사장님이 원문과 나란히 보고 누르셔야 `승인`이 된다.
 *    승인 전에는 위험 값(휠너트 토크·오일 용량)의 숫자를 화면에도 블로그에도 안 내보낸다.
 *
 *   npx tsx scripts/spec-fetch.ts --gen MQ4 --year 2022          받아서 보여만 준다
 *   npx tsx scripts/spec-fetch.ts --gen MQ4 --year 2022 --write  실제로 넣는다
 *   npx tsx scripts/spec-fetch.ts --gen MQ4                      연식을 알아서 찾는다
 */
import { config } from "dotenv";
import postgres from "postgres";
import { bothUnits, specItem } from "../src/lib/spec-core";
import {
  fetchDoc,
  fetchToc,
  harvestHtmlWithHint,
  joinUrl,
  manualBase,
  MANUAL_SITES,
  pickSpecTopics,
  sleep,
} from "../src/lib/spec-harvest";
import { rankSource, specFilter } from "../src/lib/spec-verify";

config({ path: ".env.local" });

const val = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** 연식을 모를 때 찾아볼 후보 — 우리 차량 연식 범위 안에서 최신부터, 많아야 6번 */
function yearCandidates(min: number | null, max: number | null): number[] {
  const hi = Math.min((max ?? new Date().getFullYear()) + 1, new Date().getFullYear() + 1);
  /* 오래된 세대는 우리 차 연식보다 설명서가 한두 해 이르다 — 아래로 넉넉히 본다 */
  const lo = Math.max((min ?? hi - 5) - 1, 2010);
  const out: number[] = [];
  for (let y = hi; y >= lo && out.length < 10; y--) out.push(y);
  return out;
}

async function main() {
  const key = val("--gen");
  if (!key) {
    console.error("어느 차종인지 알려 주세요:  --gen MQ4");
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const [gen] = await sql<
      { id: number; label: string; proj: string | null; maker: string; note: string | null; body_type: string | null }[]
    >`
      SELECT g.id, g.label, g.proj_code AS proj, m.maker_code AS maker, g.note, g.body_type
      FROM vehicle_generation g JOIN vehicle_model m ON m.id = g.model_id
      WHERE g.variant_key = ${key}`;
    if (!gen) {
      console.error(`「${key}」 라는 차종이 표에 없습니다.`);
      process.exit(1);
    }
    if (!gen.proj) {
      console.error(`「${gen.label}」 은 제조사 코드가 없어 설명서를 찾을 수 없습니다.`);
      process.exit(1);
    }
    const site = MANUAL_SITES[gen.maker];
    if (!site) {
      console.error(`${gen.maker} 는 아직 설명서 사이트를 모릅니다. (지금은 ${Object.keys(MANUAL_SITES).join(", ")})`);
      process.exit(1);
    }

    /** 차체 종류 — 휠너트 토크 범위 검산에 쓴다 (승용 8~15 vs 대형 25~70 kgf·m) */
    const [bt] = await sql<{ body_type: string | null }[]>`
      SELECT v.body_type FROM vehicle v
      WHERE v.generation_id = ${gen.id} AND v.body_type IS NOT NULL
      GROUP BY v.body_type ORDER BY count(*) DESC LIMIT 1`;
    const bodyType = gen.body_type ?? bt?.body_type ?? undefined;

    console.log(`▶ ${gen.label}  (${gen.maker} ${gen.proj})  차체 ${bodyType ?? "모름"}`);
    if (gen.note) console.log(`  ${gen.note}`);

    /* ① 목차 — 연식을 모르면 찾아본다 */
    const yearArg = val("--year") ? Number(val("--year")) : null;
    const noteYears = /(\d{4})~(\d{4})/.exec(gen.note ?? "");
    const years = yearArg
      ? [yearArg]
      : yearCandidates(noteYears ? Number(noteYears[1]) : null, noteYears ? Number(noteYears[2]) : null);

    /**
     * 🔴 「목차가 열렸다」가 아니라 **「제원 쪽이 실제로 있다」** 를 기준으로 삼는다.
     *    기아 새 설명서는 목차가 200 으로 열려도 형식이 달라 제원 쪽이 안 잡힌 적이 있다.
     *    거기서 멈춰 버리면 옆 연식에 멀쩡히 있는 설명서를 못 본다.
     */
    /**
     * 🔴 「목차가 열렸다」가 아니라 **「우리에게 필요한 쪽이 실제로 있다」** 를 본다.
     *
     *    두 번 데었다 (2026-09-03):
     *      ① 기아 새 설명서는 목차가 200 으로 열려도 형식이 달라 제원 쪽이 0장이었다
     *      ② 갓 올라온 2027년 그랜저 설명서에는 **「타이어 및 휠」 쪽이 아직 없었다** —
     *         최신 연식만 보고 멈추니 값이 34개에서 14개로 줄었다 (공기압·토크가 통째로 빠짐)
     *
     *    그래서 「타이어 및 휠」이 있는 연식을 먼저 찾고, 끝내 없으면
     *    제원 쪽이 하나라도 있던 연식으로 물러선다.
     */
    let base = "";
    let toc: Awaited<ReturnType<typeof fetchToc>> | null = null;
    let fallback: { base: string; toc: Awaited<ReturnType<typeof fetchToc>> } | null = null;
    for (const y of years) {
      const b = manualBase(gen.maker, gen.proj, y)!;
      const t = await fetchToc(b, site.toc);
      const picked = t.status === 200 ? pickSpecTopics(t.entries) : [];
      const hasTire = picked.some((e) => /타이어\s*및\s*휠/.test(e.title));
      console.log(`  목차 ${t.status} ${y}년  (${t.entries.length}줄, 제원 ${picked.length}장${hasTire ? ", 타이어 있음" : ""})  ${t.url}`);
      if (hasTire) {
        base = b;
        toc = t;
        break;
      }
      if (picked.length && !fallback) fallback = { base: b, toc: t };
      await sleep(700);
    }
    if (!toc && fallback) {
      console.log("  (타이어 쪽이 있는 연식을 못 찾아, 제원 쪽이 있던 연식으로 갑니다)");
      base = fallback.base;
      toc = fallback.toc;
    }
    if (!toc || !base) {
      console.error("  설명서를 못 찾았습니다. 연식을 직접 넣어 보세요:  --year 2022");
      process.exit(1);
    }

    const topics = pickSpecTopics(toc.entries);
    console.log(`  제원 쪽 ${topics.length}장: ${topics.map((t) => t.title).join(" · ")}`);
    if (!topics.length) {
      console.error("  이 설명서 목차에는 제원 쪽이 없습니다.");
      process.exit(1);
    }

    /**
     * 🔴 다시 받으면 **검수대기분만 갈아 끼운다.**
     *    같은 차종을 두 번 받았다가 값이 두 벌 쌓인 적이 있다 (G80 RG3, 2026-09-03).
     *    사장님이 이미 승인하신 줄은 건드리지 않는다 — 그건 사람의 판단이다.
     */
    if (write) {
      const wiped = await sql<{ id: number }[]>`
        DELETE FROM vehicle_spec WHERE generation_id = ${gen.id} AND status = '검수대기' RETURNING id`;
      if (wiped.length) console.log(`  (먼저 받아 둔 검수대기 ${wiped.length}개를 치웁니다)`);
    }

    /* ② 한 장씩 받아서 값으로 */
    const rank = rankSource(base);
    let ok = 0;
    let bad = 0;
    /**
     * 🔴 한 벌 번호는 **차종 안에서 안 겹쳐야 한다.**
     *    파서마다 1번부터 세기 때문에, 그대로 두면 「타이어 18인치 한 벌」과
     *    「디젤 엔진오일 한 벌」이 둘 다 1번이 된다. 그러면 검수 화면에서 한 상자에
     *    섞여 보이고, 18인치 타이어를 확인하려고 누르면 엔진오일까지 같이 확인된다.
     *    (2026-09-03 실측으로 실제 그랬다)
     */
    let groupBase = 0;
    for (const t of topics) {
      await sleep(800);
      const url = joinUrl(base, t.href);
      const doc = await fetchDoc(url);
      if (doc.status !== 200) {
        console.log(`  ⚠️ ${doc.status} ${t.title}`);
        continue;
      }
      const page = harvestHtmlWithHint(url, doc.html, doc.status, t.title);
      console.log(`\n  ── ${page.title || t.title}  (${page.specs.length}개, 원문 ${page.bodyText.length}자)`);
      if (!page.specs.length) continue;

      let sourceId: number | null = null;
      if (write) {
        const [u] = await sql<{ id: number }[]>`SELECT id FROM app_user ORDER BY id LIMIT 1`;
        const [s] = await sql<{ id: number }[]>`
          INSERT INTO spec_source (generation_id, url, host, title, kind, trust_rank, independence_key,
                                   http_status, content_sha256, body_text, requested_by)
          /* 🔴 제목은 **목차 제목**을 먼저 쓴다. 기아 페이지의 <title> 은 어느 쪽이든
             「사용설명서(요약본)」로 똑같아서, 그대로 두면 검수 화면에서 어느 쪽에서
             나온 값인지 구별이 안 된다 (2026-09-03 실측) */
          VALUES (${gen.id}, ${url}, ${new URL(url).host}, ${t.title || page.title}, '제조사설명서',
                  ${rank.rank}, ${rank.independenceKey}, ${page.status}, ${page.sha256}, ${page.bodyText}, ${u.id})
          ON CONFLICT (url, fetched_on) DO UPDATE SET body_text = EXCLUDED.body_text, title = EXCLUDED.title
          RETURNING id`;
        sourceId = s.id;
      }

      let maxGroup = 0;
      for (const c of page.specs) {
        maxGroup = Math.max(maxGroup, c.groupNo);
        const problem = specFilter(c, page.bodyText, { bodyType });
        const label = specItem(c.item)?.label ?? c.item;
        const shown = c.textValue ?? bothUnits(c.numMin!, c.numMax ?? null, c.unit!);
        const q = c.qualifier ? ` [${Object.values(c.qualifier).join(" ")}]` : "";
        if (problem) {
          bad++;
          console.log(`     ❌ ${label}${q} ${shown}  ← ${problem.reason}`);
          continue;
        }
        ok++;
        console.log(`     ✅ ${(c.groupLabel ?? "").padEnd(12)} ${label}${q}  ${shown}`);
        if (!write || sourceId === null) continue;

        const [spec] = await sql<{ id: number }[]>`
          INSERT INTO vehicle_spec (generation_id, group_no, group_label, item, qualifier,
                                    num_min, num_max, unit, text_value, status, risk, created_by)
          VALUES (${gen.id}, ${groupBase + c.groupNo}, ${c.groupLabel ?? null}, ${c.item},
                  ${c.qualifier ? sql.json(c.qualifier) : null},
                  ${c.numMin ?? null}, ${c.numMax ?? null}, ${c.unit ?? null}, ${c.textValue ?? null},
                  '검수대기', ${specItem(c.item)?.risk ?? "보통"}, ${"설명서옮김"})
          RETURNING id`;
        await sql`
          INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
          VALUES (${spec.id}, ${sourceId}, ${c.quote}, ${Math.max(0, page.bodyText.indexOf(c.quote))})
          ON CONFLICT (spec_id, source_id) DO NOTHING`;
      }
      groupBase += maxGroup;
    }

    console.log(`\n합계 — 통과 ${ok}개 · 걸림 ${bad}개`);
    if (write) {
      /**
       * 🔴 설명서 주소만 적어 둔다. year_from 은 건드리지 않는다 —
       *    2022년 설명서를 읽었다고 「MQ4 는 2022년부터」가 되는 게 아니다.
       *    그 세대가 언제부터인지는 우리가 아직 모르고, 모르는 건 비워 두는 게 맞다.
       */
      await sql`UPDATE vehicle_generation SET manual_url = ${base} WHERE id = ${gen.id}`;
      console.log(`✅ 검수대기함에 넣었습니다. 앱에서 확인하시면 됩니다.`);
    } else {
      console.log("(미리보기입니다 — 실제로 넣으려면 --write)");
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
