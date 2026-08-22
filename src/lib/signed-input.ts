/**
 * ⭐ 금액 칸에 마이너스를 허용한다 (사장님 요청 2026-08-21)
 *
 *   "판매등록시 카드결제를 취소하거나 하는 경우도 생각해서 마이너스 결제도 필요함."
 *
 * 전에는 모든 금액 칸이 숫자만 남겨(`replace(/\D/g, "")`) '-' 를 칠 수 없었다.
 * 여기 세 함수가 **맨 앞의 '-' 하나만** 살린다 — 가운데 '-' 나 '--' 는 버린다.
 *
 * 🔴 이 파일은 순수 계산이라 "use server" 가 아니다 — 화면(판매 등록·정비 내역·줄 수정)이
 *    같은 규칙을 쓴다. 규칙이 갈라지면 한 화면에선 되고 다른 화면에선 안 되는 일이 생긴다.
 */

/** 입력 문자열 → 상태로 둘 문자열 ("-" 하나 + 숫자). "" · "-" · "-5000" · "5000" */
export function signedStr(s: string): string {
  const neg = s.trim().startsWith("-");
  return (neg ? "-" : "") + s.replace(/\D/g, "");
}

/** 상태 문자열 → 정수. "" · "-" 는 0 */
export function signedInt(s: string): number {
  const neg = s.trim().startsWith("-");
  const d = s.replace(/\D/g, "");
  return d === "" ? 0 : (neg ? -1 : 1) * Number(d);
}

/** 칸에 보여줄 글자 — 치는 중인 "-" 는 그대로, 숫자는 쉼표를 넣어서 */
export function showSigned(s: string): string {
  if (s === "" || s === "-") return s;
  return signedInt(s).toLocaleString();
}
