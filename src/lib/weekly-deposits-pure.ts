/**
 * ⭐ ③ 입금 대조 — 3층 나누기 순수 함수 (개편 3단계, 2026-09-12)
 *
 * 🔴 이 파일은 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돌아야 해서
 *    weekly-deposits(DB 포함)에서 분리했다 (payables-plan 과 같은 이유).
 *
 *   판정은 전부 정본이 이미 끝냈다(depositSurePicks 가 「짝 확실」, depositTaxCandidates 가 계산서 후보,
 *   depositReconData 가 판매·미수금 후보). 여기서는 그 결과를 **층으로 나눠 담기만** 한다:
 *     · 짝 확실   = sureIds 에 든 것 (체크 기본 ON, 일괄 = confirmSureDeposits(ym, ids))
 *     · 확인해 주세요 = 확실은 아닌데 정본이 낸 후보가 **딱 1개**라 체크 한 번이면 되는 것
 *         — 묶음 있음 ∨ 계산서 후보 정확히 1 ∨ (판매 후보 정확히 1 ∧ 계산서 후보 0)
 *     · 손이 필요한 것 = 나머지(후보 여럿·없음·미수금 후보만) — 검색·수금을 그 자리에서
 *   🔴 새 판정을 만들지 않는다. 임계값도 없다 — 「1개」는 체크 목록의 조건이지 짝의 확신이 아니다.
 *      실행은 기존 낱장 액션이 서버에서 다시 검증한다.
 */
import type { DepositSuggestion } from "./recon-data";
import type { DepositTaxBundles, DepositTaxCands } from "./deposit-tax";

export interface DepositPartition {
  /** 짝 확실 — sureIds 순서 그대로(정본 Map 의 삽입 순서), open 에 있는 것만 */
  sure: number[];
  check: DepositSuggestion[];
  hand: DepositSuggestion[];
}

export function partitionDeposits(
  open: DepositSuggestion[],
  taxCands: DepositTaxCands,
  bundles: DepositTaxBundles,
  sureIds: Iterable<number>,
): DepositPartition {
  const openIds = new Set(open.map((s) => s.dep.id));
  const sure = [...new Set(sureIds)].filter((id) => openIds.has(id));
  const sureSet = new Set(sure);
  const check: DepositSuggestion[] = [];
  const hand: DepositSuggestion[] = [];
  for (const s of open) {
    if (sureSet.has(s.dep.id)) continue;
    const taxN = taxCands[s.dep.id]?.length ?? 0;
    const hasBundle = !!bundles[s.dep.id];
    const quoteN = s.quotes.length;
    const one = hasBundle || taxN === 1 || (quoteN === 1 && taxN === 0);
    (one ? check : hand).push(s);
  }
  return { sure, check, hand };
}
