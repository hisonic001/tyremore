/**
 * ⭐ 받은 돈을 어느 건에 얼마씩 넣을지 정한다 (2026-08-17)
 *
 * 🔴 이 파일은 `"use server"` 가 아니다 — 순수 계산이라 **화면과 서버가 같이 쓴다.**
 *    화면은 「오래된 3건 완납, Q26-0801-007 은 12만원 남습니다」 미리보기에,
 *    서버는 실제 수금 줄을 만들 때. 규칙이 두 벌이면 미리보기와 결과가 어긋난다.
 *    (`"use server"` 파일은 export 가 전부 async 여야 해서 여기 둘 수도 없다)
 */

export interface SettleRow {
  quoteId: number;
  quoteNo: string;
  remain: number;
}

/**
 * **오래된 건부터 전액씩** 채운다 (선입선출).
 *
 * 비례 배분이 아닌 이유: 그러면 모든 건이 어중간하게 남아 장부가 영영 안 닫힌다.
 * 오래된 것부터 털면 「완납 3건 + 미완 1건」이라 다음에 볼 것이 분명하다 —
 * 창고에서 오래된 DOT 부터 나가는 것과 같은 원리다.
 *
 * @param rows 오래된 순으로 정렬된 미납 건들
 * @param received 실제로 받은 총액
 */
export function planSettlement(
  rows: SettleRow[],
  received: number,
): { plan: { quoteId: number; amount: number }[]; leftover: number; partialQuoteNo: string | null } {
  let left = Math.max(0, Math.round(received));
  const plan: { quoteId: number; amount: number }[] = [];
  let partialQuoteNo: string | null = null;
  for (const r of rows) {
    if (left <= 0) break;
    if (r.remain <= 0) continue;
    const amount = Math.min(left, r.remain);
    plan.push({ quoteId: r.quoteId, amount });
    if (amount < r.remain) partialQuoteNo = r.quoteNo;
    left -= amount;
  }
  return { plan, leftover: left, partialQuoteNo };
}
