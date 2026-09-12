/**
 * ⭐ ④ 지출 분류 — 「이번 주 정리」 단계 (개편 3단계, 2026-09-12)
 *
 *   어댑터 weeklyExpenseStep(ym) 을 **한 번** 부르고 클라이언트 ExpensesFlow 에 넘긴다.
 *   헤더·진행막대·이전/다음은 page.tsx·nav.tsx 몫.
 */
import { weeklyExpenseStep } from "@/lib/weekly-expenses";
import { ExpensesFlow } from "./expenses-flow";

export async function ExpensesStep({ ym }: { ym: string }) {
  const step = await weeklyExpenseStep(ym);
  return <ExpensesFlow step={step} />;
}
