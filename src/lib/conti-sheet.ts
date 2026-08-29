/**
 * 콘티넨탈 2026 목록 읽기 ⭐ (사장님 제공 2026-08-29)
 *
 *   두 파일이 한 벌이다. **Material 번호가 하나도 겹치지 않는다**(실측 겹침 0)이라
 *   합쳐서 「2026 목록 736건」으로 다룬다.
 *
 *     ① `콘티넨탈타이어 운영 규격_2026.xlsx`      — 여름·사계절 560줄
 *        머리글 1줄. Brand · Rim · Size · Pattern · Description · **Material** · COC · 기표가 · 공장도가
 *        `공장도가 = 기표가 × 1.1` 이 560줄 전부 일치 → **기표가는 부가세 미포함**이다.
 *
 *     ② `2026 Winter_주문서_PSI오토모티브.xlsx`   — 겨울 176줄
 *        🔴 머리글이 **6번째 줄**에 있다 (위에 안내 5줄). 그래서 컬럼 이름으로 못 읽는다 —
 *        「`Article #` 가 있는 줄」을 찾아 머리글로 삼는다.
 *        Article # · Description · **Marketing Line**(정식 모델명) · Size · rim ·
 *        Target vehicles · 2026 List Price · Invoice Price
 *        `List Price` 도 **부가세 미포함**이다 (우리 기표가 대비 1.008~1.053배 = 3% 안팎 인상).
 *
 * 🔴 두 파일 모두 가격이 **부가세 미포함**이다. `list_price_excl` 에 넣고
 *    `list_price = round(excl × 1.1)` 로 만든다. 헷갈리면 손님에게 10% 낮게 말하게 된다.
 *
 * ⚠️ 운영 규격에는 **GENERAL(제너럴) 31줄**이 섞여 있다 — 브랜드 칸을 따라 `GN` 으로 간다.
 *    콘티넨탈 인보이스에 제네럴이 섞여 오는 것과 같은 사정이다 (`invoice.ts:33`).
 *
 * 🔴 "use server" 아님 — 순수 계산. 화면·스크립트가 같이 쓴다.
 */
import * as XLSX from "xlsx";
import { parseContiDesc, contiSeason, type ContiName } from "./conti-name";

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(text(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
/** 11자리 자재번호인가 */
const isCode = (v: unknown) => /^\d{11}$/.test(text(v));

export interface ContiRow {
  /** Material · Article # — 11자리 */
  code: string;
  /** 'CO' | 'GN' */
  brandCode: "CO" | "GN";
  /** 우리 품번 — `CO03201650000` */
  itemNo: string;
  /** 원문 설명 */
  desc: string;
  /** 겨울 주문서의 정식 모델명 (여름 파일엔 없다) */
  marketingLine: string | null;
  /** 운영 규격의 짧은 패턴코드 `ASC2` (겨울엔 없다) */
  patternCode: string | null;
  /** 운영 규격의 COC 칸 — 「SMA 전환방지 숨김」 등. 뜻을 모르니 적어만 둔다 */
  coc: string | null;
  /** 부가세 **미포함** 기표가 */
  priceExcl: number;
  sizeCode: string | null;
  rimInch: number | null;
  /** 어느 파일에서 왔나 */
  sourceLabel: string;
  /** 파일 계통 — 이름으로 다시 판정한 계절이 우선이고, 못 읽으면 이걸 쓴다 */
  fileSeason: "여름" | "겨울";
  /** 이름·속성 (conti-name) */
  parsed: ContiName;
  /** 최종 계절 */
  season: string;
}

/** 칸 이름을 공백·대소문자 무시하고 찾는다 */
function pick(row: Record<string, unknown>, ...want: string[]): unknown {
  for (const w of want) {
    const k0 = w.replace(/\s/g, "").toLowerCase();
    for (const k of Object.keys(row)) if (k.replace(/\s/g, "").toLowerCase() === k0) return row[k];
  }
  return null;
}

function toRow(o: {
  code: string;
  brand: string;
  desc: string;
  ml?: string | null;
  pat?: string | null;
  coc?: string | null;
  price: number;
  size?: string | null;
  rim?: number | null;
  label: string;
  fileSeason: "여름" | "겨울";
}): ContiRow {
  const brandCode = /general/i.test(o.brand) ? "GN" : "CO";
  const parsed = parseContiDesc(o.desc, o.ml ?? null);
  return {
    code: o.code,
    brandCode,
    itemNo: `${brandCode}${o.code}`,
    desc: o.desc,
    marketingLine: o.ml?.trim() || null,
    patternCode: o.pat?.trim() || null,
    coc: o.coc?.trim() || null,
    priceExcl: o.price,
    sizeCode: o.size?.trim() || null,
    rimInch: o.rim ?? parsed.rimInch,
    sourceLabel: o.label,
    fileSeason: o.fileSeason,
    parsed,
    season: contiSeason(parsed.name) ?? o.fileSeason,
  };
}

/* ------------------------------------------------------------------ */
/* ① 운영 규격 (여름·사계절) — 컬럼 이름으로 읽는다                      */

export function looksLikeContiSpec(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map((k) => k.replace(/\s/g, "").toLowerCase());
  return keys.includes("material") && keys.includes("description") && keys.includes("기표가");
}

export function readContiSpec(rows: Record<string, unknown>[]): { rows: ContiRow[]; skipped: number } {
  const out = new Map<string, ContiRow>();
  let skipped = 0;
  for (const r of rows) {
    const code = text(pick(r, "Material"));
    const desc = text(pick(r, "Description"));
    const price = money(pick(r, "기표가"));
    if (!isCode(code) || !desc || price === null) {
      skipped++;
      continue;
    }
    out.set(
      code,
      toRow({
        code,
        brand: text(pick(r, "Brand")) || "CONTINENTAL",
        desc,
        pat: text(pick(r, "Pattern")),
        coc: text(pick(r, "COC")),
        price,
        size: text(pick(r, "Size")),
        rim: Number(text(pick(r, "Rim"))) || null,
        label: "운영규격 2026",
        fileSeason: "여름",
      }),
    );
  }
  return { rows: [...out.values()], skipped };
}

/* ------------------------------------------------------------------ */
/* ② 겨울 주문서 — 머리글이 6번째 줄이라 자리로 읽는다                    */

/** 「Article #」 가 있는 줄이 머리글이다 */
function winterHeader(aoa: unknown[][]): { at: number; col: Map<string, number> } | null {
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const col = new Map<string, number>();
    (aoa[i] ?? []).forEach((c, j) => {
      const k = text(c).replace(/\s/g, "").toLowerCase();
      if (k && !col.has(k)) col.set(k, j);
    });
    if (col.has("article#") && col.has("description")) return { at: i, col };
  }
  return null;
}

export function looksLikeContiWinter(aoa: unknown[][]): boolean {
  return winterHeader(aoa) !== null;
}

export function readContiWinter(aoa: unknown[][]): { rows: ContiRow[]; skipped: number } {
  const h = winterHeader(aoa);
  if (!h) return { rows: [], skipped: aoa.length };
  const at = (r: unknown[], ...names: string[]) => {
    for (const n of names) {
      const j = h.col.get(n.replace(/\s/g, "").toLowerCase());
      if (j !== undefined) return r[j];
    }
    return null;
  };
  const out = new Map<string, ContiRow>();
  let skipped = 0;
  for (const r of aoa.slice(h.at + 1)) {
    const code = text(at(r, "Article #"));
    const desc = text(at(r, "Description"));
    // 🔴 머리글 아래에 안내·합계 줄이 섞인다 — 11자리 자재번호인 줄만 자료로 본다
    const price = money(at(r, "2026\nList Price\n(NEW)", "2026 List Price (NEW)", "2026ListPrice(NEW)"));
    if (!isCode(code) || !desc || price === null) {
      if (text(code) || text(desc)) skipped++;
      continue;
    }
    out.set(
      code,
      toRow({
        code,
        brand: "CONTINENTAL",
        desc,
        ml: text(at(r, "Marketing Line")),
        price,
        size: text(at(r, "Size")),
        rim: Number(text(at(r, "rim"))) || null,
        label: "겨울주문서 2026",
        fileSeason: "겨울",
      }),
    );
  }
  return { rows: [...out.values()], skipped };
}

/* ------------------------------------------------------------------ */
/* 파일 두 개를 한꺼번에 (스크립트가 쓴다)                                */

export const CONTI_DIR = "C:/Users/info/OneDrive/문서/통합자동화/콘티넨탈 상품목록/";
export const CONTI_SPEC_FILE = CONTI_DIR + "콘티넨탈타이어 운영 규격_2026.xlsx";
export const CONTI_WINTER_FILE = CONTI_DIR + "2026 Winter_주문서_PSI오토모티브.xlsx";

/**
 * ⭐ 목록에 없지만 **사장님이 실물로 확인해 주신** 자재 (2026-08-29)
 *
 *   운영 규격표는 「지금 주문 가능한 것」이라, 창고에 있는데 표에 없는 물건이 생긴다.
 *   근거 없이 두면 다음 실행마다 「목록에 없음」으로 계속 올라와 시끄럽고,
 *   이름·기표가를 따라갈 근거도 없다. 사장님이 콘티넨탈 화면에서 읽어 주신 값을 적어 둔다.
 *
 *   235/55R19 CCRX 는 **두 가지가 실제로 있다** (사장님 확인):
 *     · 15581850000 — 2025년산 · 하중 101 · 멕시코 · OE 카니발        ← 운영 규격표에 있음
 *     · 03595710000 — 2026년산 · 하중 **105** · 태국 · OE 24년형 카니발 ← 표에 없다. 우리 재고 4본
 *   하중지수가 다르면 다른 타이어다 — 합치지 않는다.
 */
const OWNER_EXTRA: { code: string; brand: string; desc: string; price: number; note: string }[] = [
  {
    code: "03595710000",
    brand: "CONTINENTAL",
    // 공장도가 313,500원 ÷ 1.1 = 기표가 285,000원 (사장님이 읽어 주신 값)
    desc: "235/55R19 105H XL CrossContact RX 24년형 카니발 OE",
    price: 285000,
    note: "사장님 확인 2026-08-29 · 태국산 4PR",
  },
];

/**
 * 2026 목록 두 파일을 읽어 한 벌로 — 여름·사계절 560 + 겨울 176 = 736.
 * 🔴 자재번호가 겹치면 자료가 잘못된 것이다. 조용히 덮지 않고 멈춘다.
 */
export function readContiAll(quiet = false): ContiRow[] {
  const wbS = XLSX.readFile(CONTI_SPEC_FILE, { raw: true });
  const s = readContiSpec(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(wbS.Sheets[wbS.SheetNames[0]], { raw: true, defval: "" }),
  );
  const wbW = XLSX.readFile(CONTI_WINTER_FILE, { raw: true });
  const w = readContiWinter(
    XLSX.utils.sheet_to_json<unknown[]>(wbW.Sheets[wbW.SheetNames[0]], { header: 1, raw: true, defval: "" }),
  );
  if (!quiet) {
    console.log(`운영규격 ${s.rows.length}줄 (건너뜀 ${s.skipped}) · 겨울주문서 ${w.rows.length}줄 (건너뜀 ${w.skipped})`);
  }
  const have = new Set([...s.rows, ...w.rows].map((r) => r.code));
  const extra = OWNER_EXTRA.filter((e) => !have.has(e.code)).map((e) =>
    toRow({ code: e.code, brand: e.brand, desc: e.desc, price: e.price, label: e.note, fileSeason: "여름" }),
  );
  if (!quiet && extra.length > 0) console.log(`사장님 확인분 ${extra.length}줄`);
  const all = [...s.rows, ...w.rows, ...extra];
  if (new Set(all.map((r) => r.code)).size !== all.length) {
    throw new Error("자재번호가 겹칩니다 — 자료를 확인해 주세요");
  }
  return all;
}
