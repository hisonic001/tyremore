/**
 * ⭐ 올린 자료 → 무엇을 자동으로 붙일까 (개편 4단계, 2026-09-12; 사장님 결정 2 「올린 직후 자동」)
 *
 *   원천마다 이미 자동으로 되는 것이 다르다 — 여기서 「더 해야 할 것」만 표로 둔다.
 *     통장          카드정산 표시 → 받은 돈 짝 확실 → 준 돈 짝 확실
 *     홈택스매입/매출 계산서 짝 확실 (한 파일이 와도 두 방향을 다 본다 — 상계·수정계산서가 섞인다)
 *     법인카드      applyAutoCategories 가 올릴 때 이미 분류한다
 *     토스포스      ingestPosTxns 가 파일에 든 날마다 autoMatchPosDayCore 를 이미 돌린다
 *     카드매출승인/입금  통장 줄이 아니라 여신·정산 자료라 붙일 짝이 없다
 *
 * 🔴 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돈다.
 * 🔴 판정은 전부 기존 정본(depositSurePicks·exactPlan·sureTaxPicks). 여기는 **순서표**일 뿐이다.
 */

export type AutoStep = "cardSettle" | "deposits" | "withdrawals" | "tax:매입" | "tax:매출";

/** 한 번에 도는 달 수 상한 — 달을 걸친 파일이 와도 질의가 무한정 늘지 않게 (풀 3) */
export const MAX_AUTO_YMS = 3;

export function autoReconPlan(source: string): AutoStep[] {
  switch (source) {
    case "통장":
      return ["cardSettle", "deposits", "withdrawals"];
    case "홈택스매입":
    case "홈택스매출":
      return ["tax:매입", "tax:매출"];
    default:
      return [];
  }
}

/** 주소·화면에서 온 달 목록을 거른다 — 형식 맞는 것만, 중복 없이, 최대 MAX_AUTO_YMS 개 */
export function cleanYms(yms: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const y of yms ?? []) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(y)) continue;
    if (out.includes(y)) continue;
    out.push(y);
    if (out.length >= MAX_AUTO_YMS) break;
  }
  return out;
}

export interface AutoReconCounts {
  cardSettle: number;
  deposits: number;
  withdrawals: number;
  tax: number;
}

export const ZERO_COUNTS: AutoReconCounts = { cardSettle: 0, deposits: 0, withdrawals: 0, tax: 0 };

export function totalOf(c: AutoReconCounts): number {
  return c.cardSettle + c.deposits + c.withdrawals + c.tax;
}

/** 「자동 대조 12건 (입금 7 · 지급 3 · 계산서 2)」 — 0인 갈래는 안 적는다 */
export function autoReconSummary(c: AutoReconCounts): string {
  const parts: string[] = [];
  if (c.deposits > 0) parts.push(`입금 ${c.deposits}`);
  if (c.withdrawals > 0) parts.push(`지급 ${c.withdrawals}`);
  if (c.tax > 0) parts.push(`계산서 ${c.tax}`);
  if (c.cardSettle > 0) parts.push(`카드정산 ${c.cardSettle}`);
  const n = totalOf(c);
  if (n === 0) return "자동으로 붙일 것 없음";
  return `자동 대조 ${n}건${parts.length > 1 ? ` (${parts.join(" · ")})` : ""}`;
}
