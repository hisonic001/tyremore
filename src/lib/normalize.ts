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

/** DOT → 제조 연도 (4자리). 미래 연도가 나오면 이전 세기로 본다 */
export function dotYear(dot: string, now = new Date()): number | null {
  if (!isValidDot(dot)) return null;
  const yy = Number(dot.slice(2, 4));
  const century = Math.floor(now.getFullYear() / 100) * 100;
  const year = century + yy;
  return year > now.getFullYear() + 1 ? year - 100 : year;
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
