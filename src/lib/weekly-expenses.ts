/**
 * ⭐ ④ 지출 분류 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   expenseData(ym) 의 unclassified 중 suggest 가 있는 줄을 payerKeyOf 로 묶어 「확인해 주세요」로,
 *   없는 줄을 「손이 필요한 것」으로. 「앱이 자동 분류한 것」은 fin_activity('분류') 되읽기.
 *   🔴 새 판정 없음 — suggest 는 expenseData(규칙 사전)가 이미 낸 것.
 *   🔴 묶음 하나 = setExpenseCategory(anyId, suggest) **한 번** — 같은 열쇠에 전파되므로 줄마다 부르면
 *      두 번째부터 「이미 붙음」이거나 기록이 두 줄 남는다. 묶음 열쇠는 fin-expense 와 같은 payerKeyOf(정본).
 *   🔴 "use server" 아님.
 */
import type { WeeklyExpenseGroup, WeeklyExpenseStep } from "./weekly-types";
import { expenseData, type ExpenseRow } from "./recon-data";
import { payerKeyOf } from "./expense-cats";
import { autoActivity } from "./fin-activity";

export async function weeklyExpenseStep(ym: string): Promise<WeeklyExpenseStep> {
  const data = await expenseData(ym);
  const groups = new Map<string, WeeklyExpenseGroup>();
  const hand: ExpenseRow[] = [];
  for (const row of data.unclassified) {
    if (row.suggest === null) {
      hand.push(row);
      continue;
    }
    /* 열쇠 = 상대(payerKeyOf) + 제안 분류 — 같은 상대는 같은 규칙에서 나오므로 제안이 다를 일은 없지만,
       다르면 묶으면 안 된다(한 번 붙이면 다른 제안이 덮인다) → 열쇠에 같이 넣는다. 구분자는 보이는 글자 `|` */
    const payer = payerKeyOf(row.source, row.description);
    const key = `${payer}|${row.suggest}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(row.id);
      g.n++;
      g.sum += row.amount;
    } else {
      groups.set(key, { key, payer, suggest: row.suggest, ids: [row.id], anyId: row.id, n: 1, sum: row.amount });
    }
  }
  // unclassified 는 금액 큰 순 — 묶음도 첫 줄(가장 큰 금액) 순서 그대로(Map 삽입 순서)
  const check = [...groups.values()];
  const auto = await autoActivity(ym, "분류");
  return { ym, data, check, hand, auto };
}
