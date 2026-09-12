/**
 * ⭐ ④ 지출 분류 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   expenseData(ym) 의 unclassified 중 suggest 가 있는 줄을 payerKeyOf 로 묶어 「확인해 주세요」로,
 *   없는 줄을 「손이 필요한 것」으로. 「앱이 자동 분류한 것」은 fin_activity('분류') 되읽기.
 *   🔴 새 판정 없음. "use server" 아님.
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 A 가 채운다.
 */
import type { WeeklyExpenseStep } from "./weekly-types";

export async function weeklyExpenseStep(_ym: string): Promise<WeeklyExpenseStep> {
  throw new Error("todo: 갈래 A — weeklyExpenseStep");
}
