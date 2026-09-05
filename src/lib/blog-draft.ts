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
  /** 거래처명 — 재료가 아니라 「쓰면 안 되는 말」로만 쓴다 */
  supplier_name: string | null;
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
/**
 * 🔴 **사장님이 직접 고르신 건에는 거래처·무상·0원 조건을 걸지 않는다** (2026-09-05).
 *
 * 거래처(렌트카·정비소) 건이라고, 무상이라고, 금액이 0원이라고 글감이 아닌 것이 아니다.
 * K8 엔진오일 건(quote 3595)이 `supplier_name = 'AJ렌트카'` 하나 때문에
 * **사진까지 다 고른 마지막 단계에서** 튕겼다. 그런데 오류 문구는 「성사·타이어 포함·
 * 거래처 아님」이라 어디에 걸렸는지 알 수 없었다.
 *
 * 이 조건들은 원래 **자동으로 고를 때** 쓰라고 둔 것인데, 자동 고르기는 없앴다(09-05).
 * 고르신 건에 남는 것은 `status = '성사'` 하나뿐이다 — 안 한 일을 글로 쓸 수는 없다.
 */
export async function factsForDay(day: string, opts?: { quoteId?: number }): Promise<DraftFacts[]> {
  const rows = await db.execute<CandRow>(sql`
    SELECT q.id AS quote_id, q.quote_no, q.work_date::text AS work_date, q.mileage,
           v.mileage AS veh_mileage, v.model, v.year,
           COALESCE(mk.name_ko, v.maker_name) AS maker,
           c.name AS customer_name, q.mars_memo,
           qi.line_type, qi.description, qi.qty,
           q.supplier_name,
           p.width, p.aspect_ratio AS aspect, p.rim_inch AS rim
    FROM quote q
    LEFT JOIN vehicle       v  ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    LEFT JOIN customer      c  ON c.id = q.customer_id
    LEFT JOIN quote_item    qi ON qi.quote_id = q.id
    LEFT JOIN product       p  ON p.id = qi.product_id
    WHERE q.status = '성사'
      ${
        opts?.quoteId
          ? sql`AND q.id = ${opts.quoteId}`
          : sql`AND q.supplier_name IS NULL
                AND COALESCE(q.payment_method, '') <> '서비스'
                AND q.total_amount > 0
                AND q.work_date = ${day}::date`
      }
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
        /**
         * 🔴 「쓰면 안 되는 말」 — 이 말들이 원고에 나오면 `privacyFilter` 가 되돌린다.
         *    **거래처 이름을 따로 넣는다** (사장님 지시 2026-09-05 — 「렌트카라고 안 나왔으면」).
         *    고객명이 사람 이름이고 거래처만 회사인 건이 있어, 고객명만으로는 못 막는다.
         *    🔴 이 말들은 **모델에 보내는 재료가 아니다.** `factsText()` 가 보내는 것은
         *       차량·시공·작업·시기·매장 다섯 줄뿐이다.
         */
        redact: [r.customer_name, r.mars_memo, r.supplier_name].filter(
          (s): s is string => !!s && s.trim().length >= 2,
        ),
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
 * 🔴 **자동으로 글감을 고르던 부분은 없앴다** (사장님 지시 2026-09-05).
 *
 * 여기에는 `pickCandidates()`(그날 시공에서 4본 교체 우선으로 N건 고르기)와
 * `recentPendingDay()`(오늘이 비면 밀린 최근 날짜로 거슬러 가기)가 있었다.
 * 사장님은 **쓸 작업을 직접 고르고 그때그때 1~2건**만 만들기를 원하신다.
 * 프로그램이 대신 고르면 안 쓸 글이 만들어지고, 고른 이유를 사장님이 알 수 없다.
 *
 * 지금 글감을 고르는 것은 사장님이다 — `recentSalesForBlog()`(아래)가 목록을 보여 주고,
 * 사진 폴더 화면이 폴더를 보여 준다. **다시 자동으로 고르게 만들지 말 것.**
 */

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
  /** 거래처(렌트카·정비소) 건인가 — 화면이 배지로 알려 준다. 글에는 이름이 안 나간다 */
  isSupplier: boolean;
}

/**
 * 🔴 거래처(렌트카·정비소) 건은 **기본으로 안 보여 준다** (2026-09-05).
 *    최근 60일 거래처 성사 건이 122건이라, 목록에 부으면 사장님 손님 건이 덮인다.
 *    다만 사장님이 그 건으로 글을 쓰실 수도 있어 `includeSupplier` 로 열 수 있게 둔다
 *    (화면의 「거래처 건도 보기」 칸).
 */
export async function recentSalesForBlog(
  days = 30,
  limit = 40,
  includeSupplier = false,
): Promise<BlogCandidate[]> {
  const rows = await db.execute<{
    quote_id: number;
    quote_no: string;
    work_date: string;
    car: string | null;
    mileage: number | string | null;
    tires: string | null;
    qty: number | string | null;
    has_draft: boolean;
    supplier_name: string | null;
  }>(sql`
    SELECT q.id AS quote_id, q.quote_no, q.work_date::text AS work_date,
           NULLIF(TRIM(CONCAT_WS(' ', COALESCE(mk.name_ko, v.maker_name), v.model,
                                 CASE WHEN v.year IS NULL THEN NULL ELSE v.year || '년식' END)), '') AS car,
           COALESCE(q.mileage, v.mileage) AS mileage,
           STRING_AGG(DISTINCT qi.description, ', ') AS tires,
           SUM(qi.qty)::int AS qty,
           EXISTS (SELECT 1 FROM blog_draft b WHERE b.quote_id = q.id AND b.status <> '버림') AS has_draft,
           q.supplier_name
    FROM quote q
    LEFT JOIN vehicle       v  ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    -- 🔴 타이어만이 아니다 (2026-09-02) — 얼라인먼트·배터리 같은 경정비도 글감이다.
    --    블로그 「경정비 서비스」 카테고리가 전화로 가장 빨리 이어진다.
    JOIN quote_item qi ON qi.quote_id = q.id AND qi.line_type IN ('tire', 'service')
    WHERE q.status = '성사'
      AND COALESCE(q.payment_method, '') <> '서비스'
      AND q.total_amount > 0
      ${includeSupplier ? sql`` : sql`AND q.supplier_name IS NULL`}
      AND q.work_date >= (now() AT TIME ZONE 'Asia/Seoul')::date - make_interval(days => ${days})
    GROUP BY q.id, q.quote_no, q.work_date, mk.name_ko, v.maker_name, v.model, v.year, q.mileage, v.mileage,
             q.supplier_name
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
    isSupplier: !!r.supplier_name,
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

  /**
   * ⭐ 영상이 있는가 (2026-09-05). **있을 때만** 본문에 영상 자리를 만들게 한다 —
   * 못 찍은 날 원고에 빈 `[영상 …]` 이 남으면 사장님이 지우셔야 한다.
   * 🔴 영상 자체는 모델에게 안 보낸다. 나는 영상 안을 못 보고, 크기도 수십 MB 다.
   */
  let videoCount = 0;
  if (opts?.folderId) {
    const vr = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM blog_photo WHERE folder_id = ${opts.folderId} AND is_video = true`);
    videoCount = Number(vr[0]?.n ?? 0);
    if (videoCount) opts?.onLog?.(`영상 ${videoCount}개가 있어 본문에 영상 자리를 둡니다`);
  }

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
    ...(videoCount
      ? [
          "",
          "[영상]",
          `이 작업에는 짧은 영상 ${videoCount}개가 있습니다 (사장님이 직접 올리십니다).`,
          "🔴 소제목 한 곳 아래에 「[영상 - 작업 장면]」을 한 줄로 딱 하나만 넣으세요.",
          "   작업이 실제로 돌아가는 대목(조이기·회전·주입)이 자연스럽습니다.",
          "   영상 내용을 본 것처럼 설명하지는 마세요 — 무엇이 찍혔는지 저는 모릅니다.",
        ]
      : []),
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
      const { makeOrderedCopies, uploadPublishImages } = await import("./blog-photo-worker");
      await makeOrderedCopies(opts.folderId, plan, opts.onLog).catch(() => null);
      /**
       * 🔴 화면에서 **끌어다 네이버에 붙일** 사진을 여기서 굽는다 (2026-09-05).
       *    지금 이 순간이 유일하게 좋은 자리다 — 사진이 이미 로컬에 내려와 있고,
       *    어느 사진을 쓸지(plan)도 막 정해졌다. Vercel 쪽에서는 이 폴더가 안 보인다.
       */
      await uploadPublishImages(opts.folderId, plan, opts.onLog).catch(() => null);
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
