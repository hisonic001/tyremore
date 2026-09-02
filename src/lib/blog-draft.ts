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
 *   · 사진은 안 보낸다. 번호판·이름·전화·정확한 주행거리·정확한 날짜도 안 보낸다.
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

/** 글 구조를 돌려 쓴다 — 같은 틀 반복은 유사문서 */
const STRUCTURES = [
  "이런 손님이 오셨다(상황) → 왜 이 타이어를 권했나 → 교체 뒤 달라진 점 → 같은 차 타시는 분께 체크리스트",
  "결론 한 줄(이 차엔 이 타이어) → 규격·주행거리로 본 교체 시점 → 후보 비교표 → 마무리",
  "계절 이야기로 시작 → 이 차종 타이어의 흔한 고민 → 이번 시공 기록 → 점검 체크리스트",
  "Q&A 형식: 손님이 물어본 것 3가지에 답하는 글 → 마지막에 이번 시공 요약표",
];

const SYSTEM = `당신은 강원도 속초의 타이어 전문점 「타이어모어 속초점」 사장이 직접 쓰는 네이버 블로그 글을 대신 초안으로 써 주는 사람입니다.
말투: 손님에게 말하듯 담백한 존댓말. 과장·감탄사·이모지 남발 없음. 1인칭("저희 매장", "제가").

반드시 지킬 것 (네이버 노출 기준):
- 첫 문단에 결론을 먼저. 서론 늘리지 않기.
- 본문 1,200~1,800자. 채우기 문장으로 늘리지 말 것.
- "속초"는 자연스럽게 2~3번만. 그 이상 반복 금지. 예: "속초 타이어 교체", "속초 미쉐린", "속초 수입차 타이어".
- 소제목 3~5개. 그중 하나는 반드시 표(마크다운 표) 또는 체크리스트(- [ ]) 로 정보를 구조화.
- 가격은 정확한 금액 대신 범위로, "재고·가격은 전화로 확인" 안내.
- 최상급·홍보 표현 금지: "최고", "1등", "강추", "무조건", "역대급".
- 본문 어딘가에 정확히 한 번 \`{{사장님_한마디}}\` 라는 글자를 그대로 넣을 것 (사장님이 직접 쓸 자리). 문단 하나가 통째로 그 자리여야 함.
- 글 끝에 "※ 아래에 매장 지도(장소)를 붙여 주세요" 한 줄.
- 태그는 10개 이하, 지역+차종+타이어명 조합.

절대 쓰지 말 것 (개인정보):
- 차량번호(일부라도), 손님 이름, 전화번호, 동네 이름, 차 색깔+모델 조합, 정확한 주행거리(주어진 "N만km대" 그대로만), 정확한 날짜, 손님의 사연·직업.
- 주어진 사실에 없는 것을 지어내지 말 것. 모르는 건 일반론으로.`;

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
    tags: { type: "array", maxItems: 10, items: { type: "string" } },
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

  const user = [
    "아래 시공 사실로 블로그 글 초안을 써 주세요.",
    "",
    facts,
    "",
    `글 구조: ${structure}`,
    titles.length ? `최근에 올린 글 제목(겹치지 않게): ${titles.slice(0, 8).join(" / ")}` : null,
    opts?.variant ? "이전 초안과 다른 각도·다른 첫 문장으로." : null,
  ]
    .filter((s) => s !== null)
    .join("\n");

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let out: { data: DraftJson; model: string };
    try {
      out = await generateJson<DraftJson>({
        system: SYSTEM,
        user,
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
