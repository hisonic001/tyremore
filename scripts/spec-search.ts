/**
 * 오일 토크를 **인터넷 교차검증**으로 받아 온다 — 매장 PC 에서 돈다 (2026-09-05, 사장님 지시)
 *
 *   npx tsx scripts/spec-search.ts --gen MQ4 --url A --url B          주소를 직접 주고 받는다
 *   npx tsx scripts/spec-search.ts --gen MQ4 --url A --url B --write  실제로 넣는다
 *   npx tsx scripts/spec-search.ts --gen MQ4                          클로드가 주소를 찾는다*
 *
 * 🔴 *클로드가 찾는 길은 **지금 막혀 있다.** 이 작업 폴더가 「신뢰됨」으로 등록돼 있지 않아
 *    클로드 CLI 가 WebSearch 권한을 거부한다(실측 2026-09-05: `web_search_requests: 0`).
 *    더 나쁜 것은, 권한이 막혀도 모델이 **검색한 척 주소를 지어내는 것**을 봤다는 점이다.
 *    그래서 이 스크립트는 **모델이 준 주소도 우리가 직접 받아 확인**한다 —
 *    받아지지 않거나 값이 안 적혀 있으면 그냥 버린다.
 *    사장님이 그 폴더를 한 번 신뢰 등록해 주시면 자동 찾기가 열린다.
 *
 * 🔴 **AI 는 「어디를 볼지」만 고른다. 값은 절대 말하지 않는다.**
 *    검색은 세 번 거짓말한 전력이 있다(메모 `vehicle-spec-db`). 실제로 한국어 검색이
 *    「일반적으로 20~30 N·m」이라는 **출처 없는 숫자**를 내놓는 것을 봤다.
 *    그래서 모델에게는 주소만 받고, **값은 우리가 그 페이지 원문에서 정규식으로 뽑는다.**
 *
 * 🔴 **서로 다른 사이트 두 곳 이상이 같은 값을 말할 때만** 넣는다.
 *    어긋나면 값을 만들지 않고 `conflict` 로 남겨 사장님께 먼저 보여드린다.
 *
 * 🔴 들어간 값은 **언제나 `검수대기`** 다. 인터넷에서 온 토크를 자동으로 맞다고 하지 않는다 —
 *    틀리면 오일팬 나사산이 나간다. 공식 설명서가 아니라 남의 사이트다.
 *
 * 🔴 약관: **사장님이 누를 때 단발 조회**만 한다. 예약도, 사이트 훑기도 없다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const FIND_SCHEMA = {
  type: "object",
  properties: {
    urls: {
      type: "array",
      items: { type: "string" },
      description: "Up to 6 page URLs that state the torque. Do NOT state any value yourself.",
    },
    note: { type: "string", description: "one short line about what you searched, in Korean" },
  },
  required: ["urls"],
  additionalProperties: false,
};

const FIND_SYSTEM = `당신은 자동차 정비 자료를 찾아 주는 사람입니다.

주어진 차종의 **엔진오일 드레인 플러그 체결 토크**와 **오일필터 체결 토크**가
**숫자로 적혀 있는 페이지 주소**를 찾아 주세요.

■ 반드시 지킬 것
1. 🔴 **값을 말하지 마세요.** 숫자를 답에 적지 마세요. 우리가 그 페이지를 직접 읽습니다.
   당신이 기억하는 값은 틀릴 수 있습니다 — 실제로 그런 일이 있었습니다.
2. 🔴 **그 페이지에 숫자가 실제로 적혀 있는 것만** 주세요. 「일반적으로 20~30」처럼
   뭉뚱그린 글이나, 값이 없는 페이지는 빼세요.
3. 정비지침서·제조사 자료·정비 전문 사이트를 먼저 보세요. 커뮤니티 글은 뒤로.
4. 서로 **다른 사이트** 주소를 주세요. 같은 사이트의 여러 쪽은 한 곳으로 셉니다.
5. 최대 6개.`;

interface Found {
  urls?: string[];
  note?: string;
}

/** 아주 단순한 HTML → 글자. 표를 살리려고 줄바꿈만 남긴다 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const args = process.argv.slice(2);
  const agent = args.includes("--agent");
  const write = args.includes("--write");
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const say = (s: string) => console.log(s);
  if (!args.includes("--api")) process.env.AI_PROVIDER = "cli";

  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    /* 앱 주문이면 어느 차종인지 주문서에서 읽는다 */
    let key = val("--gen");
    const jobId = val("--job") ? Number(val("--job")) : null;
    if (jobId) {
      const [j] = await sql<{ payload: unknown }[]>`SELECT payload FROM blog_job WHERE id = ${jobId}`;
      let p = j?.payload as { variantKey?: string } | string | null;
      if (typeof p === "string") {
        try {
          p = JSON.parse(p) as { variantKey?: string };
        } catch {
          p = null;
        }
      }
      key = (p as { variantKey?: string } | null)?.variantKey ?? key;
    }
    if (!key) {
      const msg = "어느 차종인지 알려 주세요 (--gen MQ4)";
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      process.exitCode = 1;
      return;
    }

    const [gen] = await sql<{ id: number; label: string; proj_code: string | null }[]>`
      SELECT id, label, proj_code FROM vehicle_generation WHERE variant_key = ${key}`;
    if (!gen) {
      const msg = `차종 ${key} 를 찾지 못했습니다`;
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      process.exitCode = 1;
      return;
    }
    /**
     * 🔴 차 이름·제조사를 뽑아 둔다 (2026-09-05).
     *    이게 없으면 「Most Honda Civic … 29 ft-lb」를 우리 차 값으로 집어 온다 — 실제로 그랬다.
     */
    const [mk] = await sql<{ name_ko: string; maker_code: string }[]>`
      SELECT m.name_ko, m.maker_code FROM vehicle_generation g
      JOIN vehicle_model m ON m.id = g.model_id WHERE g.id = ${gen.id}`;
    const modelName = (mk?.name_ko ?? gen.label).split("(")[0].trim();
    const makerName = mk?.maker_code ?? "";
    say(`${gen.label} (${key}) 의 오일 토크를 찾습니다 — 차 이름 「${modelName}」로 남의 차를 거릅니다`);

    /* ⓪ 주소를 직접 주셨으면 검색을 건너뛴다 — 지금은 이게 정상 경로다 */
    const given: string[] = [];
    for (let i = 0; i < args.length; i++) if (args[i] === "--url" && args[i + 1]) given.push(args[i + 1]);

    /* ① 모델은 **주소만** 고른다 */
    const { generateJsonViaCli } = await import("../src/lib/ai-cli");
    /**
     * 🔴 **스스로 찾는 길은 막아 둔다** (2026-09-05 실측).
     *    매장 PC 클로드는 `-p`(창 없는) 모드에서 **웹 도구를 아예 실행하지 못한다** —
     *    `web_search_requests: 0` 인데도 주소를 **지어내서** 답한다. 신뢰 등록·권한 허용을
     *    둘 다 해 봤지만 카운터는 0 그대로였다. 지어낸 주소를 받아 오는 것보다
     *    **아예 안 하는 것이 낫다.**
     */
    if (!given.length) {
      const msg =
        "주소를 직접 주세요 (--url ...). 매장 PC 클로드는 창 없는 모드에서 웹 검색을 못 하고, " +
        "권한이 막혀도 주소를 지어내서 답합니다 — 그래서 스스로 찾게 두지 않습니다.";
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      process.exitCode = 1;
      return;
    }

    const found = given.length
      ? { data: { urls: given, note: "사장님이 주신 주소" } as Found }
      : await generateJsonViaCli<Found>({
          system: FIND_SYSTEM,
          user: `차종: ${gen.label} (형식 ${gen.proj_code ?? key}).\n엔진오일 드레인 플러그 토크와 오일필터 토크가 숫자로 적힌 페이지 주소를 찾아 주세요.`,
          schema: FIND_SCHEMA,
          model: "sonnet",
          effort: "low",
          timeoutMs: 180_000,
          tools: ["WebSearch", "WebFetch"],
          onLog: say,
        });
    const urls = (found.data.urls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 6);
    say(`주소 ${urls.length}개를 받았습니다${found.data.note ? ` — ${found.data.note}` : ""}`);
    if (!urls.length) {
      say(agent ? "ERROR=값이 적힌 페이지를 못 찾았습니다" : "값이 적힌 페이지를 못 찾았습니다");
      return;
    }

    /* ② 우리가 직접 받아서 값을 뽑는다 */
    const { findTorques, agreeAcrossSources } = await import("../src/lib/spec-torque-core");
    const { rankSource } = await import("../src/lib/spec-verify");
    const sources: { host: string; url: string; text: string; hits: ReturnType<typeof findTorques> }[] = [];
    for (const url of urls) {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (sources.some((s) => s.host === host)) continue; // 같은 사이트는 한 곳으로 센다
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0 (tyremore spec lookup; one page per request)" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          say(`   ${host} — ${res.status}`);
          continue;
        }
        const text = htmlToText(await res.text());
        /* 🔴 차 이름을 넘긴다 — 남의 차 줄과 일반론을 걸러 내는 열쇠다 */
        const hits = findTorques(text, { model: modelName, maker: makerName });
        say(`   ${host} — 토크 ${hits.length}개`);
        if (hits.length) sources.push({ host, url, text, hits });
      } catch {
        say(`   ${host} — 못 받았습니다`);
      }
      await new Promise((r) => setTimeout(r, 800)); // 남의 서버를 몰아치지 않는다
    }

    /* ③ 두 곳 이상이 같은 값을 말하는가 */
    let saved = 0;
    for (const kind of ["oil_drain_plug_torque", "oil_filter_torque"] as const) {
      const agree = agreeAcrossSources(sources, kind);
      const name = kind === "oil_drain_plug_torque" ? "드레인 플러그" : "오일필터";
      if (!agree) {
        say(`${name}: 서로 다른 두 곳에서 같은 값을 못 찾았습니다 — 넣지 않습니다`);
        continue;
      }
      if (!agree.hosts.length) {
        say(`🔴 ${name}: 사이트마다 값이 다릅니다 — ${agree.others.map((o) => `${o.host} ${o.nm}`).join(" / ")}`);
        say(`   값을 만들지 않습니다. 어느 쪽이 맞는지는 사장님이 정하실 일입니다.`);
        continue;
      }
      say(
        `${name}: ${agree.nm}${agree.nmMax ? `~${agree.nmMax}` : ""} N·m — ${agree.hosts.join(", ")} 가 같은 값${
          agree.conflict ? ` (다른 값: ${agree.others.map((o) => `${o.host} ${o.nm}`).join(", ")})` : ""
        }`,
      );
      if (!write) continue;

      /* 출처를 먼저 저장하고, 값 하나에 **인용을 두 개** 붙인다 — 진짜 교차검증이다 */
      const specIds: number[] = [];
      const today = new Date().toISOString().slice(0, 10);
      const srcIds: number[] = [];
      for (const host of agree.hosts) {
        const s = sources.find((x) => x.host === host)!;
        const rank = rankSource(s.url);
        const [row] = await sql<{ id: number }[]>`
          INSERT INTO spec_source
            (generation_id, url, host, title, kind, trust_rank, independence_key,
             fetched_on, http_status, body_text, requested_by)
          VALUES (${gen.id}, ${s.url}, ${host}, ${`${gen.label} 오일 토크`}, '정비지침서',
                  ${rank.rank}, ${`site:${host}`}, ${today}, 200, ${s.text.slice(0, 200_000)},
                  (SELECT id FROM app_user ORDER BY id LIMIT 1))
          ON CONFLICT (url, fetched_on) DO UPDATE SET body_text = EXCLUDED.body_text
          RETURNING id`;
        srcIds.push(Number(row.id));
      }

      const [spec] = await sql<{ id: number }[]>`
        INSERT INTO vehicle_spec
          (generation_id, group_no, group_label, item, num_min, num_max, unit,
           status, risk, conflict, created_by, auto_note)
        VALUES (${gen.id}, 900, '오일 교환 토크', ${kind},
                ${agree.nm}, ${agree.nmMax}, 'N·m', '검수대기', '높음', ${agree.conflict},
                '인터넷교차검증', ${`서로 다른 ${agree.hosts.length}곳이 같은 값: ${agree.hosts.join(", ")}`})
        RETURNING id`;
      specIds.push(Number(spec.id));

      for (const [i, sid] of srcIds.entries()) {
        const s = sources.find((x) => x.host === agree.hosts[i])!;
        const hit = s.hits.find((h) => h.kind === kind)!;
        await sql`
          INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
          VALUES (${spec.id}, ${sid}, ${hit.quote}, ${Math.max(0, s.text.indexOf(hit.quote))})
          ON CONFLICT (spec_id, source_id) DO NOTHING`;
      }
      saved++;
    }

    say(`\n끝 — ${write ? `${saved}개를 넣었습니다 (전부 검수대기)` : "미리보기 (넣으려면 --write)"}`);
  } finally {
    await sql.end();
  }
}
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
