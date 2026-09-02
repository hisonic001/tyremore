/**
 * 네이버 블로그 초안 (마케팅 1단계, 2026-08-29 — docs/17-네이버-마케팅.md)
 *
 * 사장님이 앱에서 버튼을 누르면 매장 PC 대리인이 그날 시공 중 블로그감을 골라 초안을 만든다.
 *
 * 왜 이렇게 하나 (SEO 전문가·현장 운영자 리뷰):
 *   · AI 글이 안 뜨는 이유는 「무색무취·경험 신호 없음」이다. 그래서 실제 시공 사실
 *     (차종·연식·주행거리대·규격·본수·계절)을 지시문에 **반드시** 넣는다.
 *   · 그래도 문장 결이 균일하면 밀린다 — 본문에 `{{사장님_한마디}}` 자리를 남기고,
 *     사장님이 한두 줄 쓰기 전에는 복사가 안 된다 (화면이 막는다).
 *   · 사진은 안 보낸다. 번호판·이름·전화·정확한 날짜도 안 보낸다.
 *     🔴 **주행거리는 정확한 km 를 보낸다** (2026-09-02) — 사장님 실제 글이 그렇게 쓰고,
 *     뭉갠 숫자가 「AI 가 쓴 티」의 큰 축이었다. 번호판이 없으면 특정되지 않는다.
 *     모델이 지시를 어길 수 있으니 **출력을 정규식으로 한 번 더** 거른다 (privacyFilter).
 *
 * 🔴 프로그램이 블로그에 올리는 일은 없다. 발행은 사장님 손이다.
 *
 * 순수 함수(필터·사실 문장·복사본)는 blog-draft-core.ts — 화면과 테스트가 그쪽을 쓴다.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { blogDraft } from "@/db/schema";
import { generateJson } from "./ai";
import { loadStyleSamples } from "./blog-samples";
import { buildSystem, styleFilter } from "./blog-style";
import {
  duplicateWarn,
  factsText,
  mileageBand,
  OWNER_SLOT,
  privacyFilter,
  seasonPhrase,
  type DraftFacts,
} from "./blog-draft-core";

export { factsText, OWNER_SLOT, type DraftFacts } from "./blog-draft-core";

const BLOG_ID = "tyremore_sokcho";
const RSS_URL = `https://rss.blog.naver.com/${BLOG_ID}.xml`;

/* ------------------------------------------------------------------ */
/* 시공 사실 — 지시문에 들어가는 것 전부. 여기 없는 것은 API 로 안 나간다   */
/* ------------------------------------------------------------------ */

interface CandRow {
  [k: string]: unknown;
  quote_id: number | string;
  quote_no: string;
  work_date: string;
  mileage: number | string | null;
  veh_mileage: number | string | null;
  maker: string | null;
  model: string | null;
  year: number | string | null;
  customer_name: string | null;
  mars_memo: string | null;
  line_type: string | null;
  description: string | null;
  qty: number | string | null;
  width: number | string | null;
  aspect: number | string | null;
  rim: number | string | null;
}

/**
 * 어느 날의 성사 판매를 블로그 사실로 바꾼다.
 * 거래처 판매·서비스(무상)·타이어 없는 건은 뺀다 — 글감이 안 된다.
 */
export async function factsForDay(day: string, opts?: { quoteId?: number }): Promise<DraftFacts[]> {
  const rows = await db.execute<CandRow>(sql`
    SELECT q.id AS quote_id, q.quote_no, q.work_date::text AS work_date, q.mileage,
           v.mileage AS veh_mileage, v.model, v.year,
           COALESCE(mk.name_ko, v.maker_name) AS maker,
           c.name AS customer_name, q.mars_memo,
           qi.line_type, qi.description, qi.qty,
           p.width, p.aspect_ratio AS aspect, p.rim_inch AS rim
    FROM quote q
    LEFT JOIN vehicle       v  ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    LEFT JOIN customer      c  ON c.id = q.customer_id
    LEFT JOIN quote_item    qi ON qi.quote_id = q.id
    LEFT JOIN product       p  ON p.id = qi.product_id
    WHERE q.status = '성사'
      AND q.supplier_name IS NULL
      AND COALESCE(q.payment_method, '') <> '서비스'
      AND q.total_amount > 0
      AND ${opts?.quoteId ? sql`q.id = ${opts.quoteId}` : sql`q.work_date = ${day}::date`}
    ORDER BY q.id, qi.id
  `);

  const map = new Map<number, DraftFacts>();
  for (const r of rows) {
    const id = Number(r.quote_id);
    let f = map.get(id);
    if (!f) {
      const km = r.mileage ?? r.veh_mileage;
      f = {
        quoteId: id,
        quoteNo: r.quote_no,
        maker: r.maker,
        model: r.model,
        year: r.year === null ? null : Number(r.year),
        // ⭐ 정확한 km 를 그대로 (2026-09-02) — 뭉갠 숫자가 「AI 티」의 큰 축이었다
        mileage: km === null ? null : Number(km) || null,
        mileageBand: mileageBand(km === null ? null : Number(km)),
        tires: [],
        services: [],
        season: seasonPhrase(r.work_date),
        redact: [r.customer_name, r.mars_memo].filter((s): s is string => !!s && s.trim().length >= 2),
      };
      map.set(id, f);
    }
    if (!r.line_type || !r.description) continue;
    if (r.line_type === "tire") {
      // 규격은 sale-history 와 같은 규칙 — 편평비 80(밴)은 생략, 인치 17.0 → 17
      const rim = r.rim === null ? null : String(Number(r.rim));
      const spec =
        r.width && rim ? `${r.width}${r.aspect && Number(r.aspect) !== 80 ? `/${r.aspect}` : ""}R${rim}` : null;
      f.tires.push({ name: r.description, spec, qty: Number(r.qty ?? 1) });
    } else if (r.line_type === "service") {
      f.services.push(r.description);
    }
  }
  return [...map.values()].filter((f) => f.tires.length > 0);
}

/**
 * 하루치에서 블로그감 고르기 — 4본 교체 우선, 같은 차종은 하루에 하나, 이미 초안 있는 건 제외.
 */
export async function pickCandidates(day: string, limit: number): Promise<DraftFacts[]> {
  const all = await factsForDay(day);
  if (all.length === 0) return [];
  const done = await db
    .select({ quoteId: blogDraft.quoteId })
    .from(blogDraft)
    .where(sql`${blogDraft.quoteId} IN (${sql.join(all.map((f) => sql`${f.quoteId}`), sql`, `)})`);
  const skip = new Set(done.map((d) => d.quoteId));
  const qty = (f: DraftFacts) => f.tires.reduce((s, t) => s + t.qty, 0);
  const seenModel = new Set<string>();
  const out: DraftFacts[] = [];
  for (const f of all.filter((f) => !skip.has(f.quoteId)).sort((a, b) => qty(b) - qty(a))) {
    const key = `${f.maker ?? ""} ${f.model ?? ""}`.trim() || `#${f.quoteId}`;
    if (seenModel.has(key)) continue;
    seenModel.add(key);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * ⭐ 아직 글로 안 쓴 시공이 있는 **가장 최근 날짜** (2026-09-02)
 *
 * 사장님은 보통 아침에 버튼을 누르신다 — 그런데 그때 「오늘」은 아직 시공이 없어
 * 늘 「글감이 없습니다」가 뜬다. 자동화의 목적은 **밀린 것을 비우는 것**이므로,
 * 오늘이 비어 있으면 최근 14일 안에서 가장 최근에 밀린 날을 찾아 그날로 만든다.
 * (WHERE 조건은 factsForDay 와 같아야 한다 — 여기서 찾고 저기서 못 쓰면 헛돈다)
 */
export async function recentPendingDay(upto: string, backDays = 14): Promise<string | null> {
  const rows = await db.execute<{ day: string }>(sql`
    SELECT q.work_date::text AS day
    FROM quote q
    JOIN quote_item qi ON qi.quote_id = q.id
    WHERE q.status = '성사'
      AND q.supplier_name IS NULL
      AND COALESCE(q.payment_method, '') <> '서비스'
      AND q.total_amount > 0
      AND qi.line_type = 'tire'
      AND q.work_date IS NOT NULL
      AND q.work_date <= ${upto}::date
      AND q.work_date >  ${upto}::date - make_interval(days => ${backDays})
      AND NOT EXISTS (SELECT 1 FROM blog_draft b WHERE b.quote_id = q.id)
    GROUP BY 1 ORDER BY 1 DESC LIMIT 1`);
  return rows[0]?.day ?? null;
}

/* ------------------------------------------------------------------ */
/* 최근 글 제목 — 같은 주제 반복 경고 (유사문서 판정 회피)                 */
/* ------------------------------------------------------------------ */

export async function recentBlogTitles(): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(RSS_URL, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return [];
    const xml = await res.text();
    const titles: string[] = [];
    for (const m of xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)) {
      titles.push(m[1].trim());
      if (titles.length >= 30) break;
    }
    return titles;
  } catch {
    return []; // RSS 가 죽어도 초안은 만든다 — 경고만 못 할 뿐
  }
}

/* ------------------------------------------------------------------ */
/* 생성                                                                */
/* ------------------------------------------------------------------ */

/**
 * 글 여는 각도를 돌려 쓴다 — 같은 틀 반복은 유사문서.
 * 🔴 「계절 이야기로 시작」은 뺐다 (2026-09-02) — 그게 바로 사장님이 지적하신 「AI 티」였다.
 *    전부 **그날의 일**에서 출발한다.
 */
const STRUCTURES = [
  "이 차가 왜 왔는지부터 → 보니까 이랬다 → 그래서 이걸 했다 → 같은 차 타시는 분께 한마디",
  "결론 먼저(이 차엔 이 타이어를 넣었다) → 규격·주행거리로 본 판단 근거 → 작업 과정 → 마무리",
  "이번 작업에서 가장 눈에 띄었던 것 하나 → 그게 왜 생기는지 → 이번엔 이렇게 처리했다",
  "손님이 물어보신 것에 답하는 형식 → 마지막에 이번에 한 일 정리",
];

interface DraftJson {
  titles: string[];
  body: string;
  tags: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titles", "body", "tags"],
  properties: {
    titles: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
    body: { type: "string" },
    tags: { type: "array", minItems: 10, maxItems: 14, items: { type: "string" } },
  },
};

export interface GenerateResult {
  ok: true;
  id: number;
  titles: string[];
  warn: string | null;
}

/**
 * 초안 한 건 생성해 저장한다. 개인정보가 걸리면 한 번 다시 만들고, 또 걸리면 버린다.
 * @param variant 「다르게 한 번 더」 — 구조를 바꿔 새로 쓴다
 */
export async function generateDraft(
  f: DraftFacts,
  opts?: { variant?: number; titles?: string[]; onLog?: (line: string) => void },
): Promise<GenerateResult | { ok: false; error: string }> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(blogDraft);
  const structure = STRUCTURES[(Number(n) + (opts?.variant ?? 0)) % STRUCTURES.length];
  const titles = opts?.titles ?? (await recentBlogTitles());
  const warn = duplicateWarn(f, titles);
  const facts = factsText(f);

  /**
   * ⭐ 문체 정본 — 규칙 스무 개보다 **사장님이 실제로 쓰신 글 한 편**이 강하다 (2026-09-02).
   *    매장 PC 에서만 읽힌다. 못 읽으면 규칙만으로 쓴다.
   */
  const samples = await loadStyleSamples(2);
  if (samples.length) opts?.onLog?.(`사장님 글 ${samples.length}편을 문체 본보기로 넣습니다`);
  else opts?.onLog?.("사장님 글을 못 찾아 규칙만으로 씁니다 (BLOG_WORK_DIR 확인)");
  const system = buildSystem(samples);

  const baseUser = [
    "아래 시공 사실로 블로그 글 초안을 써 주세요.",
    "",
    facts,
    "",
    `글을 여는 각도: ${structure}`,
    titles.length ? `최근에 올린 글 제목(겹치지 않게): ${titles.slice(0, 8).join(" / ")}` : null,
    opts?.variant ? "이전 초안과 다른 각도·다른 첫 문장으로." : null,
    "",
    "🔴 주어진 사실이 이게 전부입니다. 손님이 무슨 말을 했는지, 무엇을 발견했는지는",
    "   적혀 있지 않으니 지어내지 마세요. 없으면 그 대목은 통째로 빼고 짧게 쓰는 편이 낫습니다.",
  ]
    .filter((s) => s !== null)
    .join("\n");

  let lastErr = "";
  /** 앞선 시도에서 잡힌 문제 — 다음 시도 지시문에 그대로 붙여 준다 */
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let out: { data: DraftJson; model: string };
    try {
      out = await generateJson<DraftJson>({
        system,
        user: feedback ? `${baseUser}\n\n앞서 쓴 글에서 이런 문제가 있었습니다. 고쳐 주세요:\n${feedback}` : baseUser,
        schema: SCHEMA,
        effort: "medium",
        onLog: opts?.onLog,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const { data, model } = out;
    const whole = `${data.titles.join("\n")}\n${data.body}\n${data.tags.join(" ")}`;
    const leak = privacyFilter(whole, f.redact);
    if (leak) {
      lastErr = `개인정보로 보이는 글자(${leak})가 나와 버렸습니다`;
      feedback = "개인정보(번호판·이름·전화)를 절대 쓰지 마세요.";
      continue;
    }
    /** ⭐ 「AI 가 쓴 티」 검사 (2026-09-02) — 걸리면 지적을 붙여 다시 쓰게 한다 */
    const style = styleFilter(data.body);
    if (style) {
      opts?.onLog?.(`다시 씁니다 — ${style.reason}`);
      lastErr = style.reason;
      feedback = style.fix;
      continue;
    }
    if (!data.body.includes(OWNER_SLOT)) {
      // 자리가 빠지면 첫 소제목 앞에 끼워 넣는다 — 사장님 육성 없는 글은 안 나가야 한다
      data.body = data.body.replace(/\n(#{1,3} )/, `\n${OWNER_SLOT}\n\n$1`);
      if (!data.body.includes(OWNER_SLOT)) data.body = `${data.body}\n\n${OWNER_SLOT}`;
    }
    const [row] = await db
      .insert(blogDraft)
      .values({
        quoteId: f.quoteId,
        titles: data.titles.slice(0, 3),
        body: data.body,
        tags: data.tags.slice(0, 10),
        facts,
        warn,
        model,
      })
      .returning({ id: blogDraft.id });
    return { ok: true, id: row.id, titles: data.titles, warn };
  }
  return { ok: false, error: lastErr || "초안을 만들지 못했습니다" };
}

/** KST 오늘 (YYYY-MM-DD) */
export const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/**
 * CLI·매장 PC 대리인이 부르는 하루치 실행.
 * 후보를 고르고 순서대로 만든다. 하나가 실패해도 다음으로 간다.
 */
export async function runNightly(
  opts: { day?: string; limit?: number; dry?: boolean; onLog?: (line: string) => void } = {},
) {
  let day = opts.day ?? kstToday();
  const log = opts.onLog ?? (() => {});
  let picked = await pickCandidates(day, opts.limit ?? 3);

  /* 날짜를 지정하지 않았는데 오늘이 비었으면, 밀려 있는 가장 최근 날로 옮겨 간다 */
  if (picked.length === 0 && !opts.day) {
    const back = await recentPendingDay(day);
    if (back && back !== day) {
      log(`오늘(${day})은 시공이 없어 ${back} 것으로 만듭니다`);
      day = back;
      picked = await pickCandidates(day, opts.limit ?? 3);
    }
  }
  const results: { quoteNo: string; facts: string; result: Awaited<ReturnType<typeof generateDraft>> | null }[] = [];
  if (opts.dry) return { day, results: picked.map((f) => ({ quoteNo: f.quoteNo, facts: factsText(f), result: null })) };
  log(`글감 ${picked.length}건을 골랐습니다 (${day})`);
  const titles = await recentBlogTitles();
  let i = 0;
  for (const f of picked) {
    i += 1;
    log(`[${i}/${picked.length}] ${f.maker ?? ""} ${f.model ?? ""} — ${f.quoteNo}`.replace(/\s+/g, " ").trim());
    const result = await generateDraft(f, { titles, onLog: opts.onLog });
    results.push({ quoteNo: f.quoteNo, facts: factsText(f), result });
  }
  return { day, results };
}

/* ------------------------------------------------------------------ */
/* 화면용 조회                                                          */
/* ------------------------------------------------------------------ */

export interface DraftListRow {
  id: number;
  status: string;
  title: string;
  facts: string;
  warn: string | null;
  hasNote: boolean;
  createdAt: Date;
  quoteNo: string | null;
}

export async function listDrafts(): Promise<DraftListRow[]> {
  const rows = await db.execute<{
    [k: string]: unknown;
    id: number | string;
    status: string;
    titles: string[];
    facts: string;
    warn: string | null;
    owner_note: string | null;
    created_at: string;
    quote_no: string | null;
  }>(sql`
    SELECT b.id, b.status, b.titles, b.facts, b.warn, b.owner_note, b.created_at, q.quote_no
    FROM blog_draft b LEFT JOIN quote q ON q.id = b.quote_id
    WHERE b.status <> '버림'
    ORDER BY (b.status = '초안') DESC, b.created_at DESC
    LIMIT 100
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    status: r.status,
    title: r.titles[0] ?? "(제목 없음)",
    facts: r.facts,
    warn: r.warn,
    hasNote: !!r.owner_note?.trim(),
    createdAt: new Date(r.created_at),
    quoteNo: r.quote_no,
  }));
}

export async function getDraft(id: number) {
  const [row] = await db.select().from(blogDraft).where(eq(blogDraft.id, id)).limit(1);
  return row ?? null;
}

/** 홈 카드용 — 아직 안 올린 초안 수 */
export async function pendingDraftCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(blogDraft).where(eq(blogDraft.status, "초안"));
  return Number(r?.n ?? 0);
}
