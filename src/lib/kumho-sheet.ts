/**
 * 금호 「자재검색」 목록 읽기 ⭐ (사장님 제공 2026-08-04)
 *
 *   "금호타이어 상품목록 대부분을 통합자동화 폴더에 넣어놓음"
 *
 * 금호 홈페이지 자재검색 화면에서 내려받은 엑셀이다. 컬럼이
 * **인보이스(발주내역조회)와 글자 그대로 같다** — 자재코드 · 자재명 · 패턴.
 * 그래서 이 목록이 있으면 인보이스 품명을 더 이상 추측하지 않아도 된다.
 *
 * 이 파일이 푸는 문제 셋
 *
 *   ① 같은 타이어인데 품번이 다르다
 *      금호 `2387392` ←→ 우리 `KM2284552`. 인보이스에는 금호 코드가 찍혀 나오니
 *      "이미 있는데도 못 알아본다". → `supplier_item_code` 에 사전을 만든다.
 *
 *   ② 우리 카탈로그에 없는 신모델
 *      HP72(크루젠 GT Pro)처럼 MARS 이관 뒤에 나온 것들. → 규격·하중속도·기표가까지
 *      갖춰 새로 만든다. 인보이스 보고 급히 만드는 것보다 훨씬 정확하다.
 *
 *   ③ 기표가가 묵었다
 *      실측(2026-08-04) — 우리 기표가와 맞아떨어진 것은 66건 중 9건뿐이고
 *      나머지는 대개 우리가 2%가량 **낮다.** 기표가는 판매가 계산의 출발점이라
 *      낮으면 그만큼 싸게 견적이 나간다.
 *
 * 🔴 **`product.mars_item_no` 는 건드리지 않는다.** MARS 입력의 기준이다 (D-08).
 * 🔴 **후보가 둘 이상이면 잇지 않는다.** 매입원가·기표가가 엉뚱한 상품에 붙으면
 *    마진이 통째로 틀어진다. 애매한 것은 사람이 본다.
 * 🔴 **기표가 갱신은 따로 고르게 한다.** 손님에게 말하는 금액이 바뀌는 일을
 *    파일 하나 올렸다고 조용히 해버리면 안 된다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatSpec, parseTireSpec } from "./tire-spec";
// 패턴코드 → 모델명 표는 인보이스 읽기와 **같은 것을 쓴다** — 두 곳이 갈라지면
// 인보이스로 만든 상품과 목록으로 만든 상품의 이름이 달라진다
import { KUMHO_SEASON, modelForPattern } from "./invoice-desc";

export const SUPPLIER = "금호";

/** 자재검색 엑셀의 컬럼 이름 */
const COL = {
  code: "자재코드",
  name: "자재명",
  pattern: "패턴",
  li: "LI",
  ss: "SS",
  price: "공장도가",
} as const;

export interface CatalogRow {
  code: string;
  /** `KH 225/45 ZR17 W04L TA51  M;RK` */
  name: string;
  /** `TA51` */
  patternCode: string;
  loadIndex: string | null;
  speedRating: string | null;
  /** 공장도가 — **VAT 포함**이다 (실측 2026-08-04, 우리 기표가와 같은 자리) */
  listPrice: number | null;
  width: number | null;
  aspectRatio: number | null;
  rimInch: string | null;
  /** 사람이 읽을 모델명 `Solus TA51` */
  model: string;
  /**
   * ⭐ 기표가 Master 전용 (2026-08-27) — **부가세 미포함** 원본값.
   *    자재검색의 「공장도가」는 VAT 포함이라 여기 값이 없다(null).
   *    값이 있으면 `list_price_excl` 에 그대로, `list_price` 는 ×1.1 반올림으로 넣는다
   *    (나눗셈 왕복 반올림으로 1원씩 어긋나는 것을 막는다).
   */
  priceExcl?: number | null;
  /** 'PCR'|'LTR'|'TBR'|'TBR(S)'|'SPECIALTY'|'Racing' — 트럭·특수는 숨겨서 만든다 */
  group?: string;
  /** '정상'|'운영'|'중단'|'미운영'|'비정상'|'미정'|'요청시 생산'|'26.03' … */
  status?: string;
  /** '①'~'④' — **운영 여부는 여기 있다.** ④ = 미운영·중단 */
  type?: string;
}

/**
 * ⭐ 새로 만들 규격인가 (사장님 결정 2026-08-27, 기준 정정본)
 *
 * 🔴 처음엔 「시점」 칸이 정상·운영인 것만 살아 있다고 봤는데 **틀렸다.**
 *    「운영」 칸은 935줄 전부 O 이고, 진짜 운영 여부는 **「유형」**에 있다 — ④(미운영 32·중단 27)만 죽은 것이다.
 *    시점의 날짜(`'26.03` 등)는 「그때 새로 나왔다」는 뜻이다. 실제로 창고의 Crugen GT Pro HP72
 *    235/55R19 22본이 `'26.03` 줄이다. 이 기준을 틀리면 살아 있는 규격 283줄이 통째로 빠진다.
 *
 * 만들 것 = 유형 ①②③ · 시점이 「비정상」이 아님 · 기표가가 있음
 *   (기표가 0원 35줄은 전부 「요청시 생산」·「미정」 — 주문이 안 되는 것들이다)
 */
export const isMakeable = (r: { type?: string; status?: string; priceExcl?: number | null; listPrice: number | null }) =>
  r.type !== "④" && r.status !== "비정상" && (r.priceExcl ?? r.listPrice ?? 0) > 0;
/** 유형 ④ — 금호가 더 이상 안 만드는 규격 */
export const isDead = (r: { type?: string }) => r.type === "④";
/** 승용·SUV인가 — 트럭·버스·특수는 만들되 숨긴다 (사장님 결정 2026-08-27) */
export const isPassenger = (g: string | undefined) => g === "PCR" || g === "LTR";

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(text(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** 컬럼 이름을 공백·대소문자 무시하고 찾는다 */
function pick(row: Record<string, unknown>, want: string): unknown {
  const w = want.replace(/\s/g, "").toLowerCase();
  for (const k of Object.keys(row)) if (k.replace(/\s/g, "").toLowerCase() === w) return row[k];
  return null;
}

/** 이 엑셀이 자재검색 목록인가 */
export function looksLikeCatalog(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map((k) => k.replace(/\s/g, "").toLowerCase());
  return keys.includes("자재코드") && keys.includes("자재명") && keys.includes("패턴");
}

/**
 * 엑셀 → 카탈로그 줄.
 * ⚠️ 자재코드가 겹치면 **뒤엣것으로 덮는다** — 사장님이 여러 번 검색해 받은
 *    파일들을 한꺼번에 올릴 수 있어야 한다.
 */
export function readCatalog(rows: Record<string, unknown>[]): { rows: CatalogRow[]; skipped: number } {
  const out = new Map<string, CatalogRow>();
  let skipped = 0;

  for (const r of rows) {
    const code = text(pick(r, COL.code));
    const name = text(pick(r, COL.name));
    // 합계 행·빈 행. 자재코드는 숫자 7자리다
    if (!/^\d{5,9}$/.test(code) || !name) {
      skipped++;
      continue;
    }
    const patternCode = text(pick(r, COL.pattern)).toUpperCase();
    const spec = parseTireSpec(name);
    out.set(code, {
      code,
      name,
      patternCode,
      // `099` → `99`. 앞의 0 을 안 떼면 우리 `99` 와 안 맞는다
      loadIndex: text(pick(r, COL.li)).replace(/^0+(?=\d)/, "") || null,
      speedRating: text(pick(r, COL.ss)).toUpperCase() || null,
      listPrice: money(pick(r, COL.price)),
      width: spec.width,
      aspectRatio: spec.aspectRatio,
      rimInch: spec.rimInch === null ? null : String(spec.rimInch),
      model: modelForPattern(patternCode),
    });
  }
  return { rows: [...out.values()], skipped };
}

/* ============================================================
 * 우리 상품과 맞춰 보기
 * ========================================================== */

export type LinkKind =
  /** 이미 사전에 있다 */
  | "이미연결"
  /** 품번(`KM`+자재코드)으로 찾았다 — 가장 확실하다 */
  | "품번"
  /** 규격 + 패턴코드로 딱 하나 찾았다 */
  | "규격+패턴"
  /** 같은 타이어에 금호가 **새 코드를 매겼다** — 이미 옛 코드가 붙어 있는 상품에 코드만 하나 더 (2026-08-27) */
  | "재코드"
  /** 후보가 둘 이상이라 고르지 않았다 */
  | "애매"
  /** 우리에게 없다 — 새로 만든다 */
  | "신규"
  /** 규격을 못 읽어 아무것도 못 한다 */
  | "규격없음";

export interface PlanLine {
  row: CatalogRow;
  kind: LinkKind;
  productId: number | null;
  /** 이어진 우리 상품 이름 */
  productName: string | null;
  ourItemNo: string | null;
  /** 애매할 때 후보들 */
  candidates: { id: number; itemNo: string; name: string }[];
  /** 우리 기표가 (VAT 포함) */
  ourPrice: number | null;
  /** 기표가가 달라 고칠 수 있는가 */
  priceChanges: boolean;
}

export interface CatalogPlan {
  lines: PlanLine[];
  counts: Record<LinkKind, number>;
  /** 읽은 줄 / 건너뛴 줄 */
  read: number;
  skipped: number;
  /** 기표가가 다른 건수와 평균 차이(%) */
  priceDiffCount: number;
  priceDiffAvgPct: number;
  /**
   * 오르는 것 / 내리는 것.
   * ⚠️ 평균만 보여 주면 안 된다 — 오름과 내림이 섞여 상쇄되면
   *    "거의 안 바뀝니다"처럼 보이는데 실제로는 개별 상품이 크게 움직인다.
   */
  priceUpCount: number;
  priceDownCount: number;
  /** 가장 크게 움직이는 것 (표시용) */
  priceBiggestPct: number;
}

/** 기표가가 「사실상 같다」고 볼 범위 — 1% 안쪽은 반올림 차이로 본다 */
const SAME_PRICE = 0.01;

export async function planCatalog(rows: Record<string, unknown>[]): Promise<CatalogPlan> {
  const { rows: cat, skipped } = readCatalog(rows);
  return planRows(cat, skipped);
}

/** 카탈로그 줄 → 대조 계획. 자재검색·기표가 Master 가 같은 규칙을 쓴다 (2026-08-27) */
export async function planRows(cat: CatalogRow[], skipped = 0): Promise<CatalogPlan> {
  const lines: PlanLine[] = [];
  const counts = {
    이미연결: 0,
    품번: 0,
    "규격+패턴": 0,
    재코드: 0,
    애매: 0,
    신규: 0,
    규격없음: 0,
  } as Record<LinkKind, number>;

  const diffs: number[] = [];
  const byCodeLine = new Map<string, PlanLine>();

  /**
   * 🔴 **이미 임자가 있는 상품에는 다른 자재코드를 붙이지 않는다** (2026-08-04 발견).
   *    첫 시험에서 `2142862`(225/60R17 99**V**)가 `2172062`(99**H**)의 상품에 붙었다.
   *    하중/속도가 다르면 다른 물건이고, 게다가 그 상품에는 이미 제 자재코드가 있었다.
   *    이렇게 붙으면 매입원가·기표가가 남의 상품에 들어간다.
   */
  const claimed = new Set<number>();
  for (const r of await db.execute<{ product_id: number }>(
    sql`SELECT product_id FROM supplier_item_code WHERE supplier = ${SUPPLIER}`,
  )) {
    claimed.add(Number(r.product_id));
  }

  const mk = (row: CatalogRow, kind: LinkKind, extra: Partial<PlanLine> = {}): PlanLine => ({
    row,
    kind,
    productId: null,
    productName: null,
    ourItemNo: null,
    candidates: [],
    ourPrice: null,
    priceChanges: false,
    ...extra,
  });

  /* ── 1차: 확실한 것부터 (사전 · 품번). 여기서 임자를 정해 둔다 ───────────
   *    ⚠️ 순서가 중요하다. 규격+패턴을 먼저 돌리면 품번으로 이어질 상품을
   *       엉뚱한 코드가 먼저 채 갈 수 있다. */
  for (const row of cat) {
    const [known] = await db.execute<{ product_id: number; mars_item_no: string | null; pattern: string | null; list_price: number | null }>(sql`
      SELECT s.product_id, p.mars_item_no, COALESCE(p.display_name, p.pattern) pattern, p.list_price
      FROM supplier_item_code s JOIN product p ON p.id = s.product_id
      WHERE s.supplier = ${SUPPLIER} AND s.code = ${row.code} LIMIT 1`);
    if (known) {
      const id = Number(known.product_id);
      claimed.add(id);
      byCodeLine.set(
        row.code,
        mk(row, "이미연결", {
          productId: id,
          productName: known.pattern,
          ourItemNo: known.mars_item_no,
          ourPrice: known.list_price === null ? null : Number(known.list_price),
        }),
      );
      continue;
    }

    const [byCode] = await db.execute<{ id: number; mars_item_no: string; pattern: string | null; list_price: number | null }>(sql`
      SELECT id, mars_item_no, COALESCE(display_name, pattern) pattern, list_price FROM product
      WHERE mars_item_no = ${"KM" + row.code} OR mars_item_no = ${row.code}
      ORDER BY (mars_item_no = ${"KM" + row.code}) DESC LIMIT 1`);
    if (byCode) {
      const id = Number(byCode.id);
      claimed.add(id);
      byCodeLine.set(
        row.code,
        mk(row, "품번", {
          productId: id,
          productName: byCode.pattern,
          ourItemNo: byCode.mars_item_no,
          ourPrice: byCode.list_price === null ? null : Number(byCode.list_price),
        }),
      );
    }
  }

  /* ── 2차: 나머지를 규격 + 패턴 + 하중/속도로 ─────────────────────────── */
  for (const row of cat) {
    if (byCodeLine.has(row.code)) continue;

    if (row.width === null || row.rimInch === null || !row.patternCode) {
      byCodeLine.set(row.code, mk(row, "규격없음"));
      continue;
    }

    /* 🔴 2026-08-27: 전엔 `raw_name ILIKE '%kumho%'` 로 금호 상품을 골랐는데, 손으로 만든 상품은
       이름이 「CRUNGEN GT PRO HP72 255/50R20」처럼 Kumho 가 없어 **후보에 아예 안 떴다** —
       재고 22본짜리 HP72 가 여기 걸려 새로 만들어질 뻔했다. 브랜드로 고른다.
       숨긴 상품도 본다 — 안 보면 숨겨진 쌍둥이가 다시 태어난다. */
    const cands = await db.execute<{ id: number; mars_item_no: string | null; pattern: string | null; list_price: number | null }>(sql`
      SELECT id, mars_item_no, COALESCE(display_name, pattern) pattern, list_price FROM product
      WHERE item_type = 'tire' AND brand_code = 'KM'
        AND width = ${row.width} AND rim_inch = ${row.rimInch}
        AND aspect_ratio IS NOT DISTINCT FROM ${row.aspectRatio}
        AND (pattern ILIKE ${"%" + row.patternCode + "%"} OR raw_name ILIKE ${"%" + row.patternCode + "%"}
             OR display_name ILIKE ${"%" + row.patternCode + "%"})
        -- 하중/속도가 적혀 있으면 같아야 한다. 안 적힌 상품은 통과시킨다
        AND (${row.loadIndex}::text IS NULL OR load_index IS NULL OR load_index = ${row.loadIndex})
        AND (${row.speedRating}::text IS NULL OR speed_rating IS NULL OR upper(speed_rating) = ${row.speedRating})
      LIMIT 6`);

    const free = cands.filter((c) => !claimed.has(Number(c.id)));

    if (free.length === 1) {
      const id = Number(free[0].id);
      claimed.add(id);
      byCodeLine.set(
        row.code,
        mk(row, "규격+패턴", {
          productId: id,
          productName: free[0].pattern,
          ourItemNo: free[0].mars_item_no,
          ourPrice: free[0].list_price === null ? null : Number(free[0].list_price),
        }),
      );
    } else if (free.length > 1) {
      byCodeLine.set(
        row.code,
        mk(row, "애매", {
          candidates: free.map((c) => ({
            id: Number(c.id),
            itemNo: c.mars_item_no ?? "",
            name: c.pattern ?? "",
          })),
        }),
      );
    } else if (cands.length === 1) {
      /* ⭐ 임자가 있는데 후보가 그것 하나뿐 — 금호가 같은 타이어에 **새 코드**를 매긴 경우다
         (2026-08-27: `2268612` → `5011492`, TA31 235/45R18 94V 그대로).
         규격·패턴·하중속도가 모두 같고 후보가 유일할 때만. 사전은 코드→상품이라 한 상품에
         코드가 여럿 붙어도 된다 — 옛 코드로 온 예전 인보이스도 계속 찾아진다. */
      const id = Number(cands[0].id);
      byCodeLine.set(
        row.code,
        mk(row, "재코드", {
          productId: id,
          productName: cands[0].pattern,
          ourItemNo: cands[0].mars_item_no,
          ourPrice: cands[0].list_price === null ? null : Number(cands[0].list_price),
        }),
      );
    } else if (cands.length > 1) {
      byCodeLine.set(
        row.code,
        mk(row, "애매", {
          candidates: cands.map((c) => ({ id: Number(c.id), itemNo: c.mars_item_no ?? "", name: c.pattern ?? "" })),
        }),
      );
    } else {
      byCodeLine.set(row.code, mk(row, "신규"));
    }
  }

  // 파일에 적힌 순서대로 되돌린다 — 사장님이 엑셀과 나란히 보신다
  for (const row of cat) {
    const line = byCodeLine.get(row.code);
    if (!line) continue;
    if (line.productId && row.listPrice && line.ourPrice) {
      const d = Math.abs(row.listPrice - line.ourPrice) / line.ourPrice;
      if (d > SAME_PRICE) {
        line.priceChanges = true;
        diffs.push(((row.listPrice - line.ourPrice) / line.ourPrice) * 100);
      }
    }
    counts[line.kind]++;
    lines.push(line);
  }

  return {
    lines,
    counts,
    read: cat.length,
    skipped,
    priceDiffCount: diffs.length,
    priceDiffAvgPct: diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0,
    priceUpCount: diffs.filter((d) => d > 0).length,
    priceDownCount: diffs.filter((d) => d < 0).length,
    priceBiggestPct: diffs.reduce((m, d) => (Math.abs(d) > Math.abs(m) ? d : m), 0),
  };
}

/* ============================================================
 * 반영
 * ========================================================== */

export interface ApplyResult {
  ok: true;
  linked: number;
  created: number;
  priceUpdated: number;
  skipped: number;
}

/**
 * @param updatePrices 기표가를 금호 공장도가로 맞출 것인가.
 *                     🔴 손님에게 말하는 금액이 바뀐다. 사장님이 고르게 한다.
 * @param createMissing 우리에게 없는 상품을 새로 만들 것인가.
 */
export async function applyCatalog(
  rows: Record<string, unknown>[],
  opts: { updatePrices: boolean; createMissing: boolean },
): Promise<ApplyResult | { ok: false; error: string }> {
  const plan = await planCatalog(rows);
  if (plan.read === 0) return { ok: false, error: "자재코드를 한 줄도 읽지 못했습니다" };

  const { parseTireAttrs } = await import("./tire-attrs");
  let linked = 0;
  let created = 0;
  let priceUpdated = 0;
  let skipped = 0;

  for (const line of plan.lines) {
    const r = line.row;

    // ── 새로 만든다
    if (line.kind === "신규") {
      if (!opts.createMissing) {
        skipped++;
        continue;
      }
      const attrs = parseTireAttrs(r.model, r.name);
      /**
       * ⭐ 이름을 몰라 계절을 못 읽은 코드는 사장님이 알려 주신 값을 쓴다.
       *    계절이 비면 「사계절 있어요?」 필터에서 이 상품이 통째로 빠진다.
       */
      const season = attrs.season ?? KUMHO_SEASON[r.patternCode] ?? null;
      /**
       * ⭐ `pattern` 이 검색에 걸리는 글자다 (규격·모델·하중속도를 한 줄로).
       *    기존 상품들과 같은 모양으로 맞춘다 — `225/60R17 Crugen Premium KL33 99H`
       */
      const label = [
        formatSpec({ width: r.width, aspectRatio: r.aspectRatio, rimInch: Number(r.rimInch) }),
        r.model,
        `${r.loadIndex ?? ""}${r.speedRating ?? ""}`,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      /**
       * ⭐ 표시 이름도 표준 규칙으로 (사장님 요청 2026-08-08) —
       *    모델명 + 겹수 + OE 마킹. 일괄 정리·인보이스 등록과 같은 조립이다.
       */
      const { parseTireName, cleanTireName } = await import("./tire-name");
      const displayName =
        cleanTireName(
          parseTireName(`Kumho ${r.name}`, r.model, {
            width: r.width,
            aspectRatio: r.aspectRatio,
            rimInch: r.rimInch,
            brandCode: "KM",
          }),
        ) || null;
      const [ins] = await db.execute<{ id: number }>(sql`
        INSERT INTO product (
          mars_item_no, item_type, is_serialized, brand_code, pattern, display_name, raw_name,
          width, aspect_ratio, rim_inch, load_index, speed_rating, season,
          is_runflat, is_acoustic, is_suv, list_price, list_price_excl,
          category, spec_parsed, is_active, created_at, updated_at
        ) VALUES (
          ${"KM" + r.code}, 'tire', true, 'KM', ${label}, ${displayName},
          ${`Kumho ${r.name}`},
          ${r.width}, ${r.aspectRatio}, ${r.rimInch}, ${r.loadIndex}, ${r.speedRating}, ${season},
          ${attrs.isRunflat}, ${attrs.isAcoustic}, ${attrs.isSuv},
          ${r.listPrice}, ${r.listPrice === null ? null : Math.round(r.listPrice / 1.1)},
          -- 🔴 '10-TIRES' 가 없으면 기본 판매 할인율 25% 규칙이 안 붙는다 (2026-08-09)
          '10-TIRES', true, true, now(), now()
        )
        ON CONFLICT (mars_item_no) DO NOTHING
        RETURNING id`);
      if (!ins) {
        skipped++;
        continue;
      }
      created++;
      await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
        VALUES (${SUPPLIER}, ${r.code}, ${Number(ins.id)}, ${r.name}, '신규', now(), now())
        ON CONFLICT (supplier, code) DO NOTHING`);
      linked++;
      continue;
    }

    // ── 못 고른 것은 그냥 둔다
    if (line.productId === null) {
      skipped++;
      continue;
    }

    // ── 사전에 적어 둔다
    if (line.kind !== "이미연결") {
      await db.execute(sql`
        INSERT INTO supplier_item_code (supplier, code, product_id, supplier_name, matched_by, created_at, updated_at)
        VALUES (${SUPPLIER}, ${r.code}, ${line.productId}, ${r.name}, ${line.kind}, now(), now())
        ON CONFLICT (supplier, code) DO UPDATE
          SET product_id = EXCLUDED.product_id, supplier_name = EXCLUDED.supplier_name, updated_at = now()`);
      linked++;
    }

    // ── 기표가
    if (opts.updatePrices && line.priceChanges && r.listPrice) {
      await db.execute(sql`
        UPDATE product SET list_price = ${r.listPrice},
                           list_price_excl = ${Math.round(r.listPrice / 1.1)},
                           updated_at = now()
        WHERE id = ${line.productId}`);
      priceUpdated++;
    }
  }

  return { ok: true, linked, created, priceUpdated, skipped };
}
