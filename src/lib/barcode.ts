/**
 * 타이어 바코드 읽기
 *
 * 사장님 확인 (2026-08-01) — 찍을 수 있는 바코드가 두 가지다
 *
 *   ① 라벨지 바코드   `441358261D590A`   ← CAI 441358 기준
 *      앞 6자리가 **CAI** 다. 뒤 8자리는 개별 식별자로 보인다.
 *      상품을 찾는 데 이것을 쓴다.
 *
 *   ② 비드(타이어 옆면) 바코드  `C3150979`
 *      CAI 와 무관한 제조 코드다. 지금은 상품을 찾을 수 없다.
 *      ⭐ 다만 라벨과 함께 찍어 두면 **개별 타이어를 물리적으로 특정**할 수 있다.
 *         D-02 에서 "바코드는 SKU 단위라 개별 본을 구분 못 한다"고 했던 전제가
 *         라벨 바코드 덕에 달라진다. 보관 서비스(2개월차)에서 크게 쓰인다.
 *
 * ⚠️ 미쉐린 기준이다. 다른 브랜드 라벨은 아직 확인하지 못했다.
 *    그래서 **CAI 를 못 찾으면 통째로 검색어로 넘긴다** — 억지로 자르지 않는다.
 */

export interface ScannedTire {
  /** 상품을 찾을 번호 (보통 CAI) */
  code: string;
  /** 개별 타이어 식별자 — 있으면 재고 한 본을 특정할 수 있다 */
  serial: string | null;
  kind: "label" | "cai" | "bead" | "unknown";
  raw: string;
}

/**
 * 스캔한 문자열을 뜯는다.
 *
 * 리더기는 키보드처럼 동작하므로 대문자·소문자가 섞여 올 수 있다.
 * 앞뒤 공백과 Enter 는 이미 제거된 상태로 들어온다고 본다.
 */
export function parseTireBarcode(input: string): ScannedTire {
  const raw = String(input ?? "").trim().toUpperCase();

  // ① 라벨 바코드 — 숫자 6자리 + 영숫자 6~10자리
  const label = /^(\d{6})([0-9A-Z]{6,10})$/.exec(raw);
  if (label) {
    return { code: label[1], serial: label[2], kind: "label", raw };
  }

  // ② CAI 를 그대로 친 경우 (5~6자리 숫자)
  if (/^\d{5,6}$/.test(raw)) {
    return { code: raw, serial: null, kind: "cai", raw };
  }

  // ③ 비드 바코드 — 영문 1자 + 숫자 (C3150979)
  if (/^[A-Z]\d{6,9}$/.test(raw)) {
    return { code: raw, serial: raw, kind: "bead", raw };
  }

  // 그 밖엔 손대지 않는다. 검색으로 넘긴다
  return { code: raw, serial: null, kind: "unknown", raw };
}

/**
 * 스캔으로 볼 수 있는 입력인가.
 * 사람이 손으로 치기엔 너무 길고 규칙적인 문자열을 스캔으로 본다.
 */
export function looksScanned(input: string): boolean {
  const s = String(input ?? "").trim();
  return s.length >= 6 && /^[0-9A-Za-z-]+$/.test(s);
}
