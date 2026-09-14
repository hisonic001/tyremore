/**
 * 이관·검색용 정규화
 *
 * 원칙: 원문은 절대 바꾸지 않는다. 정규화 값은 '검색용 사본'으로 따로 둔다.
 * `고태환[한진택배]` 는 사장님이 손님을 기억하는 방식이다 (D-10).
 */

/* ------------------------------------------------------------------
 * 고객 이름
 * ---------------------------------------------------------------- */

/** 이름에 붙은 메모를 뽑는다. `고태환[한진택배]` → { base:'고태환', memo:'한진택배' } */
export function splitNameMemo(raw: string): { base: string; memo: string | null } {
  const name = (raw ?? "").trim();
  if (!name) return { base: "", memo: null };

  const notes: string[] = [];
  // 대괄호 · 소괄호 안의 내용을 전부 모은다. (주) 같은 법인 표기는 남긴다.
  let base = name.replace(/[\[\(]([^\]\)]+)[\]\)]/g, (_m, inner: string) => {
    const v = String(inner).trim();
    if (/^주식회사$|^주$|^유$|^재$|^사$/.test(v)) return `(${v})`; // 법인격 표기는 이름의 일부
    if (v) notes.push(v);
    return " ";
  });

  base = base.replace(/\s+/g, " ").trim();
  return { base: base || name, memo: notes.length ? notes.join(" / ") : null };
}

/** 검색용 이름 — 괄호·공백·기호 제거. 검색은 name·name_search·memo 를 전부 뒤진다 */
export function normalizeName(raw: string): string {
  const { base } = splitNameMemo(raw);
  return base.replace(/[\s\-_.·,]/g, "").toLowerCase();
}

/* ------------------------------------------------------------------
 * 전화번호
 * ---------------------------------------------------------------- */

/** 숫자만 남긴다. 검색·중복판정의 기준 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // 엑셀이 앞의 0을 떨어뜨린 경우 복구 (1012345678 → 01012345678)
  if (digits.length === 10 && digits.startsWith("1")) return "0" + digits;
  return digits;
}

/**
 * ⭐ 더미(자리표시) 전화 판별 정본 (박은지 연동 사고 2026-09-09)
 *
 *   MARS 이관 데이터에 010-1111-2222 · 010-1234-5678 을 받은 고객이 184명 있다.
 *   전화 매칭이 이런 번호까지 합치면 **서로 다른 손님이 한 행에 묶인다** —
 *   벤츠 두 대(351머1108·353더6455)가 고객 264 하나에 붙어 한쪽을 고치면
 *   다른쪽도 바뀌던 실사고. 더미 번호는 어떤 매칭에서도 「같은 손님 증거」가
 *   아니다.
 */
export function isPlaceholderPhone(raw: unknown): boolean {
  const p = normalizePhone(raw);
  if (!p) return false;
  if (p === "01012345678" || p === "01011112222" || p === "01023456789") return true;
  // 010 + 같은 숫자만 반복 (01000000000 · 01011111111 …)
  if (/^010(\d)\1+$/.test(p)) return true;
  // 짝 반복 (01012121212 · 01034343434)
  if (/^010(\d\d)\1{3}$/.test(p)) return true;
  return false;
}

/**
 * 자리표시 고객 이름 — 실명이 아니라 「아무 손님」이라는 뜻의 이름들.
 * 이런 행에 새 차를 달면 서로 다른 손님이 한 행에 섞인다 (같은 사고의 265 경로).
 */
export function isPlaceholderCustomerName(raw: unknown): boolean {
  const n = String(raw ?? "").trim();
  return PLACEHOLDER_CUSTOMER_NAMES.includes(n);
}

/** 위 판정의 목록 — 리포트 SQL(report-cv.ts)도 이 상수를 본다. 두 벌로 갈라지지 않게 */
export const PLACEHOLDER_CUSTOMER_NAMES: readonly string[] = ["고객", "김고객", "관광객", "비회원", "손님", "일반고객"];

/** 표시용 010-1234-5678 */
export function formatPhone(digits: string | null): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

/* ------------------------------------------------------------------
 * 번호판
 * ---------------------------------------------------------------- */

/** 공백·하이픈 제거. `12가 3456` · `12-가-3456` → `12가3456` */
export function normalizePlate(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s\-_.]/g, "")
    .toUpperCase();
}

/**
 * 번호판으로 볼 수 있는가.
 * 현행 `12가3456` / 구형 `서울12가3456` / 축약 `123가4567` 을 받는다.
 */
export function looksLikePlate(raw: string): boolean {
  const p = normalizePlate(raw);
  return /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/.test(p);
}

/** 고객이 말하는 뒷 4자리 */
export function plateTail(raw: string): string {
  const p = normalizePlate(raw);
  return p.slice(-4);
}

/* ------------------------------------------------------------------
 * DOT — 제조주차
 * ---------------------------------------------------------------- */

export interface DotEntry {
  dot: string; // '1826'
  qty: number; // 14
}

/**
 * 사장님 엑셀의 `DOT(수량)` 컬럼을 읽는다.
 *   `0526[8]1126[1]1826[3]` → [{0526,8},{1126,1},{1826,3}]
 *   `1826[14]`              → [{1826,14}]
 *   `1826`                  → [{1826,1}]   (수량 표기가 없으면 1본)
 *
 * 이 형식은 사장님이 이미 쓰고 계신 표기다 (D-12 2번). 화면 입력도 이 모양을 따른다.
 */
export function parseDotColumn(raw: unknown): DotEntry[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];

  const out: DotEntry[] = [];
  const re = /(\d{4})\s*(?:[\[\(](\d+)[\]\)])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const dot = m[1];
    const qty = m[2] ? Number(m[2]) : 1;
    if (isValidDot(dot) && qty > 0) out.push({ dot, qty });
  }
  return out;
}

/** WWYY — 주차 01~53, 연도는 2자리. `1826` = 2026년 18주 */
export function isValidDot(dot: string): boolean {
  if (!/^\d{4}$/.test(dot)) return false;
  const week = Number(dot.slice(0, 2));
  return week >= 1 && week <= 53;
}

/**
 * 형식은 맞지만 말이 안 되는 DOT를 걸러낸다.
 *
 * 실데이터에 `1882`(18주 2082년)가 있었다 — `1822`나 `1826`의 오타로 보인다.
 * 이런 값은 **넣지 않고 비워둔다.** 틀린 연식은 선입선출과 노후화 경고를 통째로 망가뜨린다.
 * 비워두면 나중에 실물을 보고 채울 수 있다 (D-02: DOT는 선택 항목).
 *
 * 타이어 수명을 고려해 제조 15년 이내 ~ 내년까지만 인정한다.
 */
export function isPlausibleDot(dot: string, now = new Date()): boolean {
  if (!isValidDot(dot)) return false;
  const yy = Number(dot.slice(2, 4));
  const year = 2000 + yy;
  return year >= now.getFullYear() - 15 && year <= now.getFullYear() + 1;
}

/** DOT → 제조 연도 (4자리). 말이 안 되는 값이면 null */
export function dotYear(dot: string, now = new Date()): number | null {
  if (!isPlausibleDot(dot, now)) return null;
  return 2000 + Number(dot.slice(2, 4));
}

/** 제조 후 경과 연수 — 재고 노후화 경고에 쓴다 */
export function dotAgeYears(dot: string, now = new Date()): number | null {
  const y = dotYear(dot, now);
  if (y === null) return null;
  const week = Number(dot.slice(0, 2));
  const made = new Date(Date.UTC(y, 0, 1 + (week - 1) * 7));
  return (now.getTime() - made.getTime()) / (365.25 * 24 * 3600 * 1000);
}

/* ------------------------------------------------------------------
 * 기타
 * ---------------------------------------------------------------- */

/** 엑셀 셀 → 정수 금액. '1,234원' · 1234.0 · '' 을 모두 받는다 */
export function toInt(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 엑셀 셀 → 문자열. 빈 값은 null */
export function toText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}
