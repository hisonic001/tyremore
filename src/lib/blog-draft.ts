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
import { formText, type BlogForm } from "./blog-form";
import { buildSystem, styleFilter, titleFilter } from "./blog-style";
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
    } else if (r.line_type === "service" || r.line_type === "custom") {
      /**
       * `custom` 도 받는다 (2026-09-02) — 경정비 이름이 여기 들어 있는 경우가 많다.
       * 🔴 단 MARS 이관 자리표시자는 뺀다. 「품목 내역 없음」을 글에 옮기면 안 된다.
       */
      if (!/품목 내역 없음|내역 없음/.test(r.description)) f.services.push(r.description);
    }
  }
  /**
   * 🔴 타이어가 있어야 한다는 조건은 **자동으로 고를 때만** 쓴다 (2026-09-02).
   *
   * 사장님이 사진 폴더나 판매를 **직접 고르신 경우**(quoteId 지정)에는 걸러내지 않는다 —
   * 얼라인먼트·배터리·TPMS 같은 경정비 건은 타이어 품목이 없는데, 그게 블로그
   * 「경정비 서비스」 카테고리이고 「속초 배터리 교체」처럼 **전화로 가장 빨리 이어지는** 글감이다.
   * (실제로 쏘렌토 얼라인먼트 건이 이 조건에 걸려 통째로 빠져 있었다)
   */
  const all = [...map.values()];
  return opts?.quoteId ? all : all.filter((f) => f.tires.length > 0);
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

/**
 * ⭐ 「작업 후기 쓰기」 화면이 고르는 최근 시공 목록 (B단계, 2026-09-02)
 *
 * 폴더 스캔(다음 단계) 전에도 바로 쓸 수 있게, 앱 판매 기록에서 바로 고른다.
 * 이미 원고가 있는 건은 아래로 내리되 감추지는 않는다 — 「다시 쓰기」가 있다.
 */
export interface BlogCandidate {
  quoteId: number;
  quoteNo: string;
  workDate: string;
  car: string;
  mileage: number | null;
  tires: string;
  qty: number;
  hasDraft: boolean;
}

export async function recentSalesForBlog(days = 30, limit = 40): Promise<BlogCandidate[]> {
  const rows = await db.execute<{
    quote_id: number;
    quote_no: string;
    work_date: string;
    car: string | null;
    mileage: number | string | null;
    tires: string | null;
    qty: number | string | null;
    has_draft: boolean;
  }>(sql`
    SELECT q.id AS quote_id, q.quote_no, q.work_date::text AS work_date,
           NULLIF(TRIM(CONCAT_WS(' ', COALESCE(mk.name_ko, v.maker_name), v.model,
                                 CASE WHEN v.year IS NULL THEN NULL ELSE v.year || '년식' END)), '') AS car,
           COALESCE(q.mileage, v.mileage) AS mileage,
           STRING_AGG(DISTINCT qi.description, ', ') AS tires,
           SUM(qi.qty)::int AS qty,
           EXISTS (SELECT 1 FROM blog_draft b WHERE b.quote_id = q.id AND b.status <> '버림') AS has_draft
    FROM quote q
    LEFT JOIN vehicle       v  ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    -- 🔴 타이어만이 아니다 (2026-09-02) — 얼라인먼트·배터리 같은 경정비도 글감이다.
    --    블로그 「경정비 서비스」 카테고리가 전화로 가장 빨리 이어진다.
    JOIN quote_item qi ON qi.quote_id = q.id AND qi.line_type IN ('tire', 'service')
    WHERE q.status = '성사'
      AND q.supplier_name IS NULL
      AND COALESCE(q.payment_method, '') <> '서비스'
      AND q.total_amount > 0
      AND q.work_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - make_interval(days => ${days})
    GROUP BY q.id, q.quote_no, q.work_date, mk.name_ko, v.maker_name, v.model, v.year, q.mileage, v.mileage
    ORDER BY has_draft ASC, q.work_date DESC, q.id DESC
    LIMIT ${limit}`);

  return rows.map((r) => ({
    quoteId: Number(r.quote_id),
    quoteNo: r.quote_no,
    workDate: r.work_date,
    car: r.car ?? "차종 미상",
    mileage: r.mileage === null ? null : Number(r.mileage) || null,
    tires: r.tires ?? "",
    qty: Number(r.qty ?? 0),
    hasDraft: !!r.has_draft,
  }));
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
  /** ⭐ 사진이 있을 때만 (C단계) — 어느 파일을 몇 번 자리에 어떤 설명으로 넣을지 */
  photos?: { file: string; slot: string; caption: string }[];
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

/** 사진이 있을 때 쓰는 스키마 — 사진 배치 계획을 같이 받는다 */
const SCHEMA_WITH_PHOTOS = {
  type: "object",
  additionalProperties: false,
  required: ["titles", "body", "tags", "photos"],
  properties: {
    ...SCHEMA.properties,
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "slot", "caption"],
        properties: {
          file: { type: "string" },
          slot: { type: "string" },
          caption: { type: "string" },
        },
      },
    },
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
  opts?: {
    variant?: number;
    titles?: string[];
    onLog?: (line: string) => void;
    /** ⭐ 사장님이 채운 작업 후기 (B단계) — 이게 있으면 글이 완전히 달라진다 */
    form?: BlogForm;
    /** ⭐ 사진 (C단계) — 임시 폴더와 그 안의 파일 목록. 원본 폴더가 아니다 */
    photos?: { dir: string; files: { photoId: number; tempName: string }[] };
    /** 사진 폴더 id — 정렬 복사본을 만들 곳 */
    folderId?: number;
  },
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

  /** ⭐ 사장님이 채운 후기 — 이게 있으면 「사건」이 생겨 일반론을 쓸 이유가 사라진다 */
  const note = opts?.form ? formText(opts.form) : "";
  if (note) opts?.onLog?.("사장님이 적으신 후기를 함께 넣습니다");

  /** ⭐ 사진 (C단계) — 임시 폴더의 `p00.jpg` 들. 원본 경로는 절대 안 나간다 */
  const photoFiles = opts?.photos?.files ?? [];
  if (photoFiles.length) opts?.onLog?.(`사진 ${photoFiles.length}장을 보여 줍니다`);

  const baseUser = [
    "아래 내용으로 블로그 글 초안을 써 주세요.",
    "",
    "[시공 기록]",
    facts,
    ...(note
      ? [
          "",
          "[사장님이 직접 적으신 것 — 이 글의 알맹이입니다]",
          note,
          "",
          "🔴 위 「사장님이 적으신 것」을 글의 중심에 두세요. 왜 오셨는지로 시작해,",
          "   무엇을 봤는지를 이야기하고, 왜 그 제품을 권했는지로 이어 가세요.",
          "   측정한 값이 있으면 반드시 그 숫자를 본문에 그대로 쓰세요.",
        ]
      : [
          "",
          "🔴 주어진 사실이 이게 전부입니다. 손님이 무슨 말을 했는지, 무엇을 발견했는지는",
          "   적혀 있지 않으니 지어내지 마세요. 없으면 그 대목은 통째로 빼고 짧게 쓰는 편이 낫습니다.",
        ]),
    ...(photoFiles.length
      ? [
          "",
          "[사진]",
          `사진 ${photoFiles.length}장이 준비돼 있습니다: ${photoFiles.map((p) => p.tempName).join(", ")}`,
          "🔴 Read 도구로 **이 사진들을 전부 먼저 보세요.** 보고 나서 글을 쓰세요.",
          "   ① 각 사진이 무엇인지 파악하고,",
          "   ② 글의 흐름에 맞게 순서를 정해 `photos` 에 담으세요.",
          "      slot 은 A-00 부터 (A=입고·진단, B=작업, C=출고·확인), caption 은 짧은 한국어 설명.",
          "   ③ 본문 안에 그 자리를 `[사진 A-00 - 계기판 주행거리]` 처럼 **그대로 써 넣으세요.**",
          "      사진 자리는 문단과 문단 사이에 한 줄로 둡니다.",
          "   ④ 사진에서 본 것(마모 모양·수치 화면·제품 라벨)을 글에 쓰세요. 이게 글을 살립니다.",
          "🔴 사진에 **번호판 글자가 읽히는 것**이 있으면 그 사진은 photos 에서 빼고,",
          "   caption 에 「번호판 보임」이라고 적어 알려 주세요. 본문에는 절대 옮겨 적지 마세요.",
        ]
      : []),
    "",
    `글을 여는 각도: ${structure}`,
    titles.length ? `최근에 올린 글 제목(겹치지 않게): ${titles.slice(0, 8).join(" / ")}` : null,
    opts?.variant ? "이전 초안과 다른 각도·다른 첫 문장으로." : null,
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
        schema: photoFiles.length ? SCHEMA_WITH_PHOTOS : SCHEMA,
        effort: "medium",
        onLog: opts?.onLog,
        imageDir: opts?.photos?.dir,
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
    /**
     * ⭐ 제목 검사 (2026-09-04) — 제목에는 검사가 하나도 없었다.
     *    실측으로 앱이 만든 제목이 38~58자라 **전부 모바일에서 잘렸고**,
     *    「여름 끝물 9월…」 같은 계절 제목까지 나왔다.
     */
    const title = titleFilter(data.titles);
    if (title) {
      opts?.onLog?.(`다시 씁니다 — ${title.reason}`);
      lastErr = title.reason;
      feedback = title.fix;
      continue;
    }
    /**
     * 사장님 한마디 자리.
     * 🔴 폼을 채우신 경우에는 **강요하지 않는다** — 4·5·7 자체가 사장님 육성이라
     *    두 번 받을 이유가 없다 (B단계 결정 2026-09-02).
     */
    if (!note && !data.body.includes(OWNER_SLOT)) {
      data.body = `${data.body.trimEnd()}\n\n${OWNER_SLOT}`;
    }

    /**
     * ⭐ 사진 계획 (C단계) — 모델이 준 `p03.jpg` 를 우리 photoId 로 되돌린다.
     * 🔴 개수를 대조한다. 사진을 줬는데 모델이 못 봤으면(계획이 비었으면) **조용히 넘어가지 않는다**
     *    — 가장 나쁜 실패는 사진 없는 글이 그냥 나오는 것이다.
     */
    let plan: { photoId: number; slot: string; caption: string }[] = [];
    if (photoFiles.length) {
      const byTemp = new Map(photoFiles.map((p) => [p.tempName, p.photoId]));
      plan = (data.photos ?? [])
        .map((p) => ({ photoId: byTemp.get(p.file) ?? 0, slot: p.slot, caption: p.caption }))
        .filter((p) => p.photoId > 0);
      if (plan.length === 0) {
        opts?.onLog?.("다시 씁니다 — 사진을 줬는데 배치 계획이 비었습니다");
        lastErr = "사진을 보고도 배치를 안 정했습니다";
        feedback = `준비된 사진(${photoFiles.map((p) => p.tempName).join(", ")})을 Read 로 전부 읽고, photos 에 배치를 반드시 담으세요.`;
        continue;
      }
      opts?.onLog?.(`사진 ${plan.length}장의 자리를 잡았습니다 (준 것 ${photoFiles.length}장)`);
    }

    const [row] = await db
      .insert(blogDraft)
      .values({
        quoteId: f.quoteId,
        titles: data.titles.slice(0, 3),
        body: data.body,
        tags: data.tags.slice(0, 14),
        facts,
        warn,
        form: opts?.form ? (opts.form as unknown as Record<string, unknown>) : null,
        source: photoFiles.length ? "사진" : note ? "폼" : "auto",
        folderId: opts?.folderId ?? null,
        photoPlan: plan.length ? plan : null,
        model,
      })
      .returning({ id: blogDraft.id });

    /** 사장님이 벤츠 GLS 폴더에 손수 하시던 방식 그대로 — `_블로그\A-00 ….jpg` */
    if (plan.length && opts?.folderId) {
      const { makeOrderedCopies } = await import("./blog-photo-worker");
      await makeOrderedCopies(opts.folderId, plan, opts.onLog).catch(() => null);
    }

    return { ok: true, id: row.id, titles: data.titles, warn };
  }
  return { ok: false, error: lastErr || "초안을 만들지 못했습니다" };
}

/**
 * ⭐ 시공 없이 쓰는 **정보성 글** (D단계, 2026-09-02)
 *
 * 「차종별 순정 제원」·「차량 관리팁」은 시공이 없어도 쓸 수 있어 **글감이 마르지 않는다.**
 * 검색 의도가 분명하고 경쟁이 약해, 이 매장 블로그에서 가장 저평가된 카테고리다.
 *
 * 🔴 그냥 일반론을 쓰면 예전 글로 돌아간다. 그래서 **이 매장의 실제 통계**를 재료로 넣는다
 *    — 「속초에서 셀토스 3대에 235/45R18을 넣었다」는 남이 못 쓰는 근거다.
 */
export async function generateTopicDraft(opts: {
  title: string;
  category: string;
  /** 이 매장 통계 등 — 지시문에 그대로 들어간다 */
  material: string;
  onLog?: (line: string) => void;
}): Promise<GenerateResult | { ok: false; error: string }> {
  const titles = await recentBlogTitles();
  const samples = await loadStyleSamples(2);
  if (samples.length) opts.onLog?.(`사장님 글 ${samples.length}편을 문체 본보기로 넣습니다`);
  const system = buildSystem(samples);

  const facts = [`글 종류: ${opts.category}`, `주제: ${opts.title}`, "", opts.material].join("\n");

  const baseUser = [
    "아래 주제로 블로그 글 초안을 써 주세요. 이번 글은 **특정 손님의 시공기가 아니라 정보성 글**입니다.",
    "",
    "[주제와 재료]",
    facts,
    "",
    "🔴 이 글은 손님 한 분의 이야기가 아니므로 「방문하신 고객님」으로 시작하지 마세요.",
    "   대신 **이 매장에서 실제로 겪은 것**으로 시작하세요 — 위 통계가 그 근거입니다.",
    "   예: 「속초에서 이 차종을 자주 봅니다. 지금까지 N대 작업했는데…」",
    "🔴 위 재료에 없는 숫자를 지어내지 마세요. 제원표를 외워 쓰지 말고, 모르면 쓰지 마세요.",
    "   차종 제원은 「차량 설명서나 운전석 문 안쪽 스티커를 보시라」고 안내하는 편이 정확합니다.",
    "🔴 이 글에는 사진 자리표시자를 넣지 마세요.",
    "",
    titles.length ? `최근에 올린 글 제목(겹치지 않게): ${titles.slice(0, 8).join(" / ")}` : null,
  ]
    .filter((s) => s !== null)
    .join("\n");

  let lastErr = "";
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let out: { data: DraftJson; model: string };
    try {
      out = await generateJson<DraftJson>({
        system,
        user: feedback ? `${baseUser}\n\n앞서 쓴 글의 문제입니다. 고쳐 주세요:\n${feedback}` : baseUser,
        schema: SCHEMA,
        effort: "medium",
        onLog: opts.onLog,
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const { data, model } = out;
    /** 정보성 글에는 손님이 없으니 redact 는 비지만, 번호판·전화 패턴은 그대로 본다 */
    const leak = privacyFilter(`${data.titles.join("\n")}\n${data.body}`, []);
    if (leak) {
      lastErr = `개인정보로 보이는 글자(${leak})가 나와 버렸습니다`;
      feedback = "번호판·전화번호처럼 보이는 숫자를 쓰지 마세요.";
      continue;
    }
    const style = styleFilter(data.body);
    if (style) {
      opts.onLog?.(`다시 씁니다 — ${style.reason}`);
      lastErr = style.reason;
      feedback = style.fix;
      continue;
    }
    const title = titleFilter(data.titles);
    if (title) {
      opts.onLog?.(`다시 씁니다 — ${title.reason}`);
      lastErr = title.reason;
      feedback = title.fix;
      continue;
    }
    if (!data.body.includes(OWNER_SLOT)) data.body = `${data.body.trimEnd()}\n\n${OWNER_SLOT}`;

    const [row] = await db
      .insert(blogDraft)
      .values({
        quoteId: null,
        titles: data.titles.slice(0, 3),
        body: data.body,
        tags: data.tags.slice(0, 14),
        facts,
        warn: null,
        source: "정보",
        model,
      })
      .returning({ id: blogDraft.id });
    return { ok: true, id: row.id, titles: data.titles, warn: null };
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
