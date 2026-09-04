/**
 * 「이 차에 맞는 부품」 — 순수 규칙 (2026-09-04)
 *
 * 🔴 `@/db` 를 import 하지 않는다 — 화면과 시험이 같이 쓴다 (spec-core.ts 와 같은 태도).
 *
 * 🔴 **여기 있는 낱말 경계 규칙 한 줄이 안전장치다.**
 *    적용 차종 글자는 사람이 손으로 적은 자유 문장이라 코드가 다른 낱말 안에 숨어 있다.
 *    `RBK`(투싼) 안의 `BK`(제네시스 쿠페)를 잡으면 그 순간 **다른 차의 부품 품번**을 권하게 된다.
 *    **틀린 품번은 없는 것보다 나쁘다.**
 *    SQL(`~*`)과 화면의 잘라내기가 **같은 규칙**을 쓰도록 여기 한 곳에서만 만든다.
 */

/** 적용 차종 글자에서 이 코드를 낱말로 찾는 정규식 (SQL·화면 공용) */
export function codeWordPattern(code: string): string {
  /* 코드에 정규식 기호가 섞여 들어와도 글자 그대로 찾도록 막아 둔다 */
  const safe = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(^|[^A-Za-z0-9])${safe}([^A-Za-z0-9]|$)`;
}

/** 적용 차종 글자에 이 코드가 낱말로 들어 있나 */
export function fitmentHasCode(fitment: string, code: string): boolean {
  return new RegExp(codeWordPattern(code), "i").test(fitment);
}

/**
 * 적용 차종 글자에서 **왜 이 부품이 걸렸는지** 코드 언저리를 잘라 낸다.
 * 제원 검수 화면이 원문 줄을 보여 주는 것과 같은 이치 — 정비사가 눈으로 확인해야 한다.
 */
export function whySnippet(fitment: string, code: string): string {
  const m = new RegExp(codeWordPattern(code), "i").exec(fitment);
  if (!m) return fitment.slice(0, 60);
  const at = m.index;
  const from = Math.max(0, at - 22);
  const to = Math.min(fitment.length, at + code.length + 24);
  return `${from > 0 ? "…" : ""}${fitment.slice(from, to).trim()}${to < fitment.length ? "…" : ""}`;
}
