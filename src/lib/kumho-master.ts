/**
 * 금호 「기표가 Master」 읽기 ⭐ (사장님 제공 2026-08-27)
 *
 *   `금호타이어_기표가(26년7월).xlsx` — 한국영업 내수 자재 내역 Master file.
 *   금호가 **현재 운영하는 규격 전부**와 그 달 기표가가 들어 있는 공식 목록이다.
 *   자재검색(kumho-sheet.ts)과 같은 물건을 다루지만 세 가지가 다르다:
 *
 *     ① 머리글이 3줄이다 (제목 / 헤더 / 부헤더) — 컬럼 이름으로 못 읽는다
 *     ② **기표가가 부가세 미포함**이다. 자재검색의 「공장도가」는 VAT 포함이었다
 *        (실측 2026-08-04). 이걸 헷갈리면 손님에게 10% 낮게 말하게 된다.
 *     ③ 「운영 시점」이 있다 — 정상·운영 / 중단·미운영·비정상·미정·요청시 생산
 *
 *   대조·사전 등록·상품 생성은 자재검색과 **같은 한 벌**(kumho-sheet.planRows)을 쓴다.
 *   두 벌이 되면 같은 타이어가 두 상품으로 갈라진다 — 그게 원래 문제였다.
 *
 * 🔴 TBR 의 `R175`·`R225` 는 17.5인치·22.5인치다. 그대로 두면 규격 파서가
 *    「175인치」로 읽어 버려 트럭 규격 89줄이 통째로 규격없음이 됐다 (2026-08-27).
 */
import { parseTireSpec } from "./tire-spec";
import { modelForPattern } from "./invoice-desc";
import type { CatalogRow } from "./kumho-sheet";

const text = (v: unknown) => String(v ?? "").trim();
const money = (v: unknown) => {
  const n = Number(text(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** 컬럼 자리 — 머리글 3줄 아래로 고정이다 */
const C = { grp: 0, pat: 1, code: 2, name: 3, size: 4, oe: 5, run: 6, type: 7, status: 8, price: 9, li: 12, ss: 13, origin: 14 } as const;

/** 이 엑셀이 기표가 Master 인가 */
export function looksLikeMaster(aoa: unknown[][]): boolean {
  const head = aoa.slice(0, 4).map((r) => r.map((c) => text(c)).join("|"));
  return head.some((h) => h.includes("자재내역") && h.includes("기표가"));
}

/**
 * 트럭 규격 표기를 파서가 아는 모양으로 — `R175` → `R17.5`, `R225` → `R22.5`.
 * `R15`·`R16` 처럼 두 자리는 그대로 둔다.
 */
export function normalizeKumhoName(name: string): string {
  return name.replace(/\bR(1[0-9]|2[0-9])5\b/g, (m, p1) => `R${p1}.5`);
}

export interface MasterRow extends CatalogRow {
  group: string;
  status: string;
  /** '①'~'④' — 운영 여부의 정본 (④ = 미운영·중단) */
  type: string;
  priceExcl: number | null;
}

/** 시트를 배열의 배열로 읽어 넘긴다 (머리글 3줄은 여기서 버린다) */
export function readMaster(aoa: unknown[][]): { rows: MasterRow[]; skipped: number } {
  const out = new Map<string, MasterRow>();
  let skipped = 0;
  for (const r of aoa.slice(3)) {
    const code = text(r[C.code]);
    const name = text(r[C.name]);
    if (!/^\d{5,9}$/.test(code) || !name) {
      skipped++;
      continue;
    }
    const patternCode = text(r[C.pat]).toUpperCase();
    const spec = parseTireSpec(normalizeKumhoName(name));
    const excl = money(r[C.price]);
    out.set(code, {
      code,
      name,
      patternCode,
      loadIndex: text(r[C.li]).replace(/^0+(?=\d)/, "") || null,
      speedRating: text(r[C.ss]).toUpperCase() || null,
      // 우리 `list_price` 자리(VAT 포함)에 맞춘 값 — 대조·비교는 이걸로 한다
      listPrice: excl === null ? null : Math.round(excl * 1.1),
      priceExcl: excl,
      width: spec.width,
      aspectRatio: spec.aspectRatio,
      rimInch: spec.rimInch === null ? null : String(spec.rimInch),
      model: modelForPattern(patternCode),
      group: text(r[C.grp]),
      status: text(r[C.status]),
      type: text(r[C.type]),
    });
  }
  return { rows: [...out.values()], skipped };
}
