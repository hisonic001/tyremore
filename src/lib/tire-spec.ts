/**
 * 타이어 규격 파서
 *
 * MARS 상품명 원문에서 규격을 뽑아낸다. 실측 성공률 99.0% (10,319건 중 101건 실패).
 * 실패한 것은 버리지 않고 import_issue 로 보내 사람이 보정한다.
 *
 * raw_name 을 항상 보존하므로, 이 파서를 나중에 고쳐서 다시 돌릴 수 있다.
 */

export interface TireSpec {
  width: number | null; // 225
  aspectRatio: number | null; // 45
  rimInch: number | null; // 17 (17.5 대비 소수 허용)
  loadIndex: string | null; // '94'
  speedRating: string | null; // 'W'
  season: string | null; // '사계절' | '여름' | '겨울'
  parsed: boolean;
}

const EMPTY: TireSpec = {
  width: null,
  aspectRatio: null,
  rimInch: null,
  loadIndex: null,
  speedRating: null,
  season: null,
  parsed: false,
};

/**
 * 일반 승용 규격.  225/45R17 · P225/45ZR17 · LT235/85R16 · 205/55R16.5
 *   접두(P/LT/ST)와 Z/W 같은 속도기호 삽입, 림 인치 소수점을 모두 받는다.
 */
const RE_METRIC =
  /(?:^|[^0-9])(?:P|LT|ST)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*(?:Z|W|Y)?\s*R\s*F?\s*(\d{2}(?:\.\d)?)/i;

/** 플로테이션 규격 (SUV·트럭).  31X10.50R15 */
const RE_FLOTATION = /(?:^|[^0-9])(\d{2}(?:\.\d+)?)\s*[X×]\s*(\d{1,2}(?:\.\d+)?)\s*R\s*(\d{2}(?:\.\d)?)/i;

/** 하중지수 + 속도기호.  '94W', '104/102T', '91 V' — 규격 뒤에 붙는다 */
const RE_LOAD_SPEED = /\b(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z]{1,2})\b/;

const SEASON_HINTS: [RegExp, string][] = [
  [/CROSS\s*CLIMATE|ALL\s*SEASON|4\s*SEASON|사계절/i, "사계절"],
  [/WINTER|ALPIN|ICE|SNOW|블리자크|BLIZZAK|윈터|겨울|X-?ICE/i, "겨울"],
  [/SUMMER|여름/i, "여름"],
];

function detectSeason(name: string): string | null {
  for (const [re, label] of SEASON_HINTS) if (re.test(name)) return label;
  return null;
}

/**
 * 상품명에서 규격을 파싱한다.
 * @param rawName MARS 「상세 항목 및 서비스」 원문
 */
export function parseTireSpec(rawName: string): TireSpec {
  if (!rawName) return { ...EMPTY };
  const name = rawName.replace(/\s+/g, " ").trim();
  const season = detectSeason(name);

  let width: number | null = null;
  let aspectRatio: number | null = null;
  let rimInch: number | null = null;
  let matchEnd = -1;

  const m = RE_METRIC.exec(name);
  if (m) {
    width = Number(m[1]);
    aspectRatio = Number(m[2]);
    rimInch = Number(m[3]);
    matchEnd = m.index + m[0].length;
  } else {
    const f = RE_FLOTATION.exec(name);
    if (f) {
      // 31X10.50R15 → 폭은 인치라 mm로 환산하지 않는다. 원문 의미를 유지하되
      // 검색이 되도록 rim 만 정확히 잡는다.
      width = null;
      aspectRatio = null;
      rimInch = Number(f[3]);
      matchEnd = f.index + f[0].length;
    }
  }

  if (rimInch === null) {
    return { ...EMPTY, season };
  }

  // 하중지수·속도기호는 규격 '뒤'에서만 찾는다. 앞에서 찾으면 상품코드를 오인한다.
  let loadIndex: string | null = null;
  let speedRating: string | null = null;
  const tail = name.slice(matchEnd);
  const ls = RE_LOAD_SPEED.exec(tail);
  if (ls) {
    loadIndex = ls[1];
    speedRating = ls[2].toUpperCase();
  }

  // 상식 범위를 벗어나면 파싱 실패로 본다 (오탐 방지)
  const sane =
    (width === null || (width >= 125 && width <= 405)) &&
    (aspectRatio === null || (aspectRatio >= 20 && aspectRatio <= 95)) &&
    rimInch >= 10 &&
    rimInch <= 30;

  if (!sane) return { ...EMPTY, season };

  return { width, aspectRatio, rimInch, loadIndex, speedRating, season, parsed: true };
}

/** '225/45R17' 형태의 표시용 문자열 */
export function formatSpec(s: Pick<TireSpec, "width" | "aspectRatio" | "rimInch">): string | null {
  if (s.width && s.aspectRatio && s.rimInch !== null) {
    const rim = Number.isInteger(s.rimInch) ? String(s.rimInch) : String(s.rimInch);
    return `${s.width}/${s.aspectRatio}R${rim}`;
  }
  return null;
}

/**
 * 사용자가 친 검색어에서 규격을 읽는다.
 * '2254517' · '225/45/17' · '225 45 17' · '225/45R17' 을 전부 같은 것으로 본다.
 * 통합 검색창(D-11 1번)이 "이건 규격이다" 라고 판단하는 근거.
 */
export function parseSpecQuery(q: string): { width: number; aspectRatio: number; rimInch: number } | null {
  const t = q.trim().toUpperCase();

  // 구분자가 있는 경우
  const sep = /^(\d{3})\s*[\/\-\s]\s*(\d{2})\s*(?:[\/\-\sR]\s*)?(\d{2}(?:\.\d)?)$/.exec(t);
  if (sep) {
    return { width: +sep[1], aspectRatio: +sep[2], rimInch: +sep[3] };
  }

  // 구분자 없이 7자리 — 2254517
  const flat = /^(\d{3})(\d{2})(\d{2})$/.exec(t);
  if (flat) {
    const w = +flat[1],
      a = +flat[2],
      r = +flat[3];
    if (w >= 125 && w <= 405 && a >= 20 && a <= 95 && r >= 10 && r <= 30) {
      return { width: w, aspectRatio: a, rimInch: r };
    }
  }
  return null;
}
