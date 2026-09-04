/**
 * 차종 하나의 순정 제원을 제조사 취급설명서에서 받아 온다 (2026-09-03)
 *
 * 길이 둘이다:
 *   ① **온라인 설명서** (`ownersmanual.hyundai.com` 등) — 현행 세대만 있다
 *   ② **현대 공식 자료실의 단종차종 PDF** — 구형은 여기에만 있다 (2026-09-04 추가)
 *      매장에 제일 많이 오는 구형(그랜드 스타렉스 TQ·싼타페 DM·그랜저 HG·아반떼 AD…)이
 *      전부 ②로만 구할 수 있다. ①에서 못 찾으면 자동으로 ②로 넘어간다.
 *
 * 🔴 **사람이 눌러야만 돈다.** 스스로 돌지 않는다. 한 번에 차종 하나.
 *    한 실행에 요청 대여섯 번이고 사이에 쉰다. 긁지 않는다.
 * 🔴 들어간 값은 전부 `검수대기` 다. 사장님이 원문과 나란히 보고 누르셔야 `승인`이 된다.
 *    승인 전에는 위험 값(휠너트 토크·오일 용량)의 숫자를 화면에도 블로그에도 안 내보낸다.
 *
 *   npx tsx scripts/spec-fetch.ts --gen MQ4 --year 2022          받아서 보여만 준다
 *   npx tsx scripts/spec-fetch.ts --gen MQ4 --year 2022 --write  실제로 넣는다
 *   npx tsx scripts/spec-fetch.ts --gen TQ                       온라인에 없으면 자료실로
 *   npx tsx scripts/spec-fetch.ts --gen TQ --archive             자료실만 본다
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import type { Sql } from "postgres";
import { downloadPdf, findSpecDoc, gridsToBodyText, pdfToGrids } from "../src/lib/spec-archive";
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
import { harvestGrids, type HarvestedSpec } from "../src/lib/spec-manual";
import { rankSource, specFilter } from "../src/lib/spec-verify";

config({ path: ".env.local" });

const val = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** 연식을 모를 때 찾아볼 후보 — 우리 차량 연식 범위 안에서 최신부터, 많아야 열 번 */
function yearCandidates(min: number | null, max: number | null): number[] {
  const hi = Math.min((max ?? new Date().getFullYear()) + 1, new Date().getFullYear() + 1);
  /* 오래된 세대는 우리 차 연식보다 설명서가 한두 해 이르다 — 아래로 넉넉히 본다 */
  const lo = Math.max((min ?? hi - 5) - 1, 2010);
  const out: number[] = [];
  for (let y = hi; y >= lo && out.length < 10; y--) out.push(y);
  return out;
}

/* ------------------------------------------------------------------ */
/* 저장 — 온라인이든 PDF 든 여기 하나로 모인다                            */
/* ------------------------------------------------------------------ */

interface StoreCtx {
  sql: Sql;
  genId: number;
  bodyType: string | undefined;
  write: boolean;
  /** 한 벌 번호가 차종 안에서 안 겹치게 이어 붙인다 */
  groupBase: { n: number };
  count: { ok: number; bad: number };
}

/**
 * 한 문서에서 뽑은 값을 검사하고 넣는다.
 * 🔴 `specFilter` 를 통과 못 한 값은 **버린다.** 고쳐서 넣지 않는다 —
 *    검사에 걸렸다는 건 원문과 어긋난다는 뜻이고, 어긋난 값은 없느니만 못하다.
 */
async function storeDoc(
  ctx: StoreCtx,
  doc: { url: string; title: string; bodyText: string; sha: string; status: number; specs: HarvestedSpec[] },
): Promise<void> {
  const { sql } = ctx;
  console.log(`\n  ── ${doc.title}  (${doc.specs.length}개, 원문 ${doc.bodyText.length}자)`);
  if (!doc.specs.length) return;

  let sourceId: number | null = null;
  if (ctx.write) {
    const rank = rankSource(doc.url);
    const [u] = await sql<{ id: number }[]>`SELECT id FROM app_user ORDER BY id LIMIT 1`;
    const [s] = await sql<{ id: number }[]>`
      INSERT INTO spec_source (generation_id, url, host, title, kind, trust_rank, independence_key,
                               http_status, content_sha256, body_text, requested_by)
      VALUES (${ctx.genId}, ${doc.url}, ${new URL(doc.url).host}, ${doc.title}, '제조사설명서',
              ${rank.rank}, ${rank.independenceKey}, ${doc.status}, ${doc.sha}, ${doc.bodyText}, ${u.id})
      ON CONFLICT (url, fetched_on) DO UPDATE SET body_text = EXCLUDED.body_text, title = EXCLUDED.title
      RETURNING id`;
    sourceId = s.id;
  }

  let maxGroup = 0;
  for (const c of doc.specs) {
    maxGroup = Math.max(maxGroup, c.groupNo);
    const problem = specFilter(c, doc.bodyText, { bodyType: ctx.bodyType });
    const label = specItem(c.item)?.label ?? c.item;
    const shown = c.textValue ?? bothUnits(c.numMin!, c.numMax ?? null, c.unit!);
    const q = c.qualifier ? ` [${Object.values(c.qualifier).join(" ")}]` : "";
    if (problem) {
      ctx.count.bad++;
      console.log(`     ❌ ${label}${q} ${shown}  ← ${problem.reason}`);
      continue;
    }
    ctx.count.ok++;
    console.log(`     ✅ ${(c.groupLabel ?? "").slice(0, 20).padEnd(20)} ${label}${q}  ${shown}`);
    if (!ctx.write || sourceId === null) continue;

    const [spec] = await sql<{ id: number }[]>`
      INSERT INTO vehicle_spec (generation_id, group_no, group_label, item, qualifier,
                                num_min, num_max, unit, text_value, status, risk, created_by)
      VALUES (${ctx.genId}, ${ctx.groupBase.n + c.groupNo}, ${c.groupLabel ?? null}, ${c.item},
              ${c.qualifier ? sql.json(c.qualifier) : null},
              ${c.numMin ?? null}, ${c.numMax ?? null}, ${c.unit ?? null}, ${c.textValue ?? null},
              '검수대기', ${specItem(c.item)?.risk ?? "보통"}, ${"설명서옮김"})
      RETURNING id`;
    await sql`
      INSERT INTO spec_citation (spec_id, source_id, quote, quote_pos)
      VALUES (${spec.id}, ${sourceId}, ${c.quote}, ${Math.max(0, doc.bodyText.indexOf(c.quote))})
      ON CONFLICT (spec_id, source_id) DO NOTHING`;
  }
  ctx.groupBase.n += maxGroup;
}

/* ------------------------------------------------------------------ */

async function main() {
  const write = process.argv.includes("--write");
  const archiveOnly = process.argv.includes("--archive");
  const allN = process.argv.includes("--all") ? Number(val("--all") ?? 40) : 0;
  const oneKey = val("--gen");
  if (!oneKey && !allN) {
    console.error("어느 차종인지 알려 주세요:  --gen MQ4   (또는 제원 없는 차종 전부: --all 40)");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    /**
     * 🔴 `--all` 은 **아직 제원이 없는 차종만** 차 많은 순으로 돈다.
     *    이미 값이 있는 차종은 건드리지 않는다 — 사장님이 검수하신 것을 흔들지 않기 위해서다.
     */
    const keys = oneKey
      ? [oneKey]
      : (
          await sql<{ k: string }[]>`
            SELECT g.variant_key k,
                   (SELECT count(*)::int FROM vehicle v WHERE v.generation_id = g.id AND v.is_active) cars
            FROM vehicle_generation g
            WHERE g.proj_code IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM vehicle_spec s WHERE s.generation_id = g.id)
            ORDER BY cars DESC LIMIT ${allN}`
        ).map((r) => r.k);

    let done = 0;
    for (const key of keys) {
      const got = await runOne(sql, key, { write, archiveOnly });
      if (got) done++;
      if (keys.length > 1) await sleep(1200);
    }
    if (keys.length > 1) console.log(`
════ 차종 ${keys.length}종 중 ${done}종에서 값을 찾았습니다 ════`);
  } finally {
    await sql.end();
  }
}

/** 차종 하나 — 찾으면 true */
async function runOne(sql: Sql, key: string, opts: { write: boolean; archiveOnly: boolean }): Promise<boolean> {
  const { write, archiveOnly } = opts;
  {
    const [gen] = await sql<
      { id: number; label: string; proj: string | null; maker: string; note: string | null; body_type: string | null }[]
    >`
      SELECT g.id, g.label, g.proj_code AS proj, m.maker_code AS maker, g.note, g.body_type
      FROM vehicle_generation g JOIN vehicle_model m ON m.id = g.model_id
      WHERE g.variant_key = ${key}`;
    if (!gen) {
      console.error(`「${key}」 라는 차종이 표에 없습니다.`);
      return false;
    }
    if (!gen.proj) {
      console.error(`「${gen.label}」 은 제조사 코드가 없어 설명서를 찾을 수 없습니다.`);
      return false;
    }

    /** 차체 종류 — 휠너트 토크 범위 검산에 쓴다 (승용 8~20 vs 대형 25~70 kgf·m) */
    const [bt] = await sql<{ body_type: string | null }[]>`
      SELECT v.body_type FROM vehicle v
      WHERE v.generation_id = ${gen.id} AND v.body_type IS NOT NULL
      GROUP BY v.body_type ORDER BY count(*) DESC LIMIT 1`;
    const bodyType = gen.body_type ?? bt?.body_type ?? undefined;

    console.log(`▶ ${gen.label}  (${gen.maker} ${gen.proj})  차체 ${bodyType ?? "모름"}`);
    if (gen.note) console.log(`  ${gen.note}`);

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

    const ctx: StoreCtx = { sql, genId: gen.id, bodyType, write, groupBase: { n: 0 }, count: { ok: 0, bad: 0 } };
    let manualUrl: string | null = null;

    /* ① 온라인 설명서 */
    if (!archiveOnly) manualUrl = await fromOnline(ctx, gen);

    /* ② 온라인에 없으면 자료실 PDF */
    if (!manualUrl) {
      console.log(archiveOnly ? "  자료실만 봅니다." : "  온라인 설명서에 없습니다 — 자료실(단종차종)을 봅니다.");
      manualUrl = await fromArchive(ctx, gen.proj);
    }

    console.log(`  합계 — 통과 ${ctx.count.ok}개 · 걸림 ${ctx.count.bad}개`);
    if (!ctx.count.ok) {
      console.error("  이 차종은 아직 설명서를 못 찾았습니다.");
      return false;
    }
    if (write) {
      /**
       * 🔴 설명서 주소만 적어 둔다. year_from 은 건드리지 않는다 —
       *    2022년 설명서를 읽었다고 「MQ4 는 2022년부터」가 되는 게 아니다.
       */
      if (manualUrl) await sql`UPDATE vehicle_generation SET manual_url = ${manualUrl} WHERE id = ${gen.id}`;
      console.log("  ✅ 검수대기함에 넣었습니다.");
    } else {
      console.log("  (미리보기입니다 — 실제로 넣으려면 --write)");
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* ① 온라인 설명서                                                      */
/* ------------------------------------------------------------------ */

async function fromOnline(
  ctx: StoreCtx,
  gen: { proj: string | null; maker: string; note: string | null },
): Promise<string | null> {
  const site = MANUAL_SITES[gen.maker];
  if (!site || !gen.proj) return null;

  const yearArg = val("--year") ? Number(val("--year")) : null;
  const noteYears = /(\d{4})~(\d{4})/.exec(gen.note ?? "");
  const years = yearArg
    ? [yearArg]
    : yearCandidates(noteYears ? Number(noteYears[1]) : null, noteYears ? Number(noteYears[2]) : null);

  /**
   * 🔴 「목차가 열렸다」가 아니라 **「우리에게 필요한 쪽이 실제로 있다」** 를 본다.
   *    두 번 데었다 (2026-09-03):
   *      ① 기아 새 설명서는 목차가 200 으로 열려도 형식이 달라 제원 쪽이 0장이었다
   *      ② 갓 올라온 2027년 그랜저 설명서에는 「타이어 및 휠」 쪽이 아직 없어서
   *         값이 34개에서 14개로 줄었다 (공기압·토크가 통째로 빠짐)
   */
  let base = "";
  let toc: Awaited<ReturnType<typeof fetchToc>> | null = null;
  let fallback: { base: string; toc: Awaited<ReturnType<typeof fetchToc>> } | null = null;
  for (const y of years) {
    const b = manualBase(gen.maker, gen.proj, y)!;
    const t = await fetchToc(b, site.toc);
    const picked = t.status === 200 ? pickSpecTopics(t.entries) : [];
    const hasTire = picked.some((e) => /타이어\s*및\s*휠/.test(e.title));
    console.log(`  목차 ${t.status} ${y}년  (${t.entries.length}줄, 제원 ${picked.length}장${hasTire ? ", 타이어 있음" : ""})`);
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
  if (!toc || !base) return null;

  const topics = pickSpecTopics(toc.entries);
  console.log(`  제원 쪽 ${topics.length}장: ${topics.map((t) => t.title).join(" · ")}`);
  if (!topics.length) return null;

  for (const t of topics) {
    await sleep(800);
    const url = joinUrl(base, t.href);
    const doc = await fetchDoc(url);
    if (doc.status !== 200) {
      console.log(`  ⚠️ ${doc.status} ${t.title}`);
      continue;
    }
    const page = harvestHtmlWithHint(url, doc.html, doc.status, t.title);
    /* 🔴 제목은 목차 제목을 먼저 쓴다 — 기아 페이지의 <title> 은 어느 쪽이든 같다 */
    await storeDoc(ctx, {
      url,
      title: t.title || page.title,
      bodyText: page.bodyText,
      sha: page.sha256,
      status: page.status,
      specs: page.specs,
    });
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* ② 자료실 PDF (단종차종)                                              */
/* ------------------------------------------------------------------ */

async function fromArchive(ctx: StoreCtx, projCode: string): Promise<string | null> {
  const found = await findSpecDoc(projCode);
  if (!found) {
    console.log(`  자료실에도 「${projCode}」 차량정보 쪽이 없습니다.`);
    return null;
  }
  console.log(`  자료실: ${found.title}  (${found.year ?? "?"}년)`);
  await sleep(500);
  const buf = await downloadPdf(found.url);
  if (!buf) {
    console.log(`  ⚠️ PDF 를 못 받았습니다: ${found.url}`);
    return null;
  }
  console.log(`  PDF ${Math.round(buf.length / 1024)}KB 받음 — 표를 읽습니다`);

  const pages = await pdfToGrids(buf);
  const bodyText = gridsToBodyText(pages);
  const sha = createHash("sha256").update(bodyText, "utf8").digest("hex");

  /**
   * 🔴 쪽마다 따로 넣지 않고 **문서 하나로** 넣는다. 자료실 PDF 는 한 파일이
   *    한 장(章)이라 주소가 하나뿐이고, 인용문 대조도 문서 전체를 놓고 해야 맞는다.
   */
  const specs: HarvestedSpec[] = [];
  let base = 0;
  for (const p of pages) {
    const got = harvestGrids("", p.grids);
    for (const c of got) specs.push({ ...c, groupNo: base + c.groupNo });
    base += got.reduce((m, c) => Math.max(m, c.groupNo), 0);
  }
  await storeDoc(ctx, { url: found.url, title: found.title, bodyText, sha, status: 200, specs });
  return found.url;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
