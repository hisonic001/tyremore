/**
 * ⭐ 「이번 주 정리」 흐름 — 순수 도우미 (개편 3단계, 2026-09-12)
 *
 *   /finance/weekly?step=N 의 N 을 정한다. 이 저장소 최초의 「단계 넘기기」 화면이라 선례가 없다 —
 *   규칙은 단순하게: 1~7 정수면 그대로, 아니면 **첫 미완 단계**(할 것이 있고 때가 된 것), 그것도 없으면
 *   마지막 단계(7, 「정리 끝 ✓」 단추가 거기 있다).
 *
 * 🔴 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돈다.
 */
import type { WeeklyStep } from "./weekly-steps";

/** ① ② … ⑦ — 첫 화면·진행막대·머리에 같은 글자 */
export const STEP_MARK = ["①", "②", "③", "④", "⑤", "⑥", "⑦"] as const;
export function stepMark(no: number): string {
  return STEP_MARK[no - 1] ?? String(no);
}

export function parseStep(raw: unknown, steps: WeeklyStep[]): number {
  const max = steps.length || STEP_MARK.length;
  const n = typeof raw === "string" && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= max) return n;
  const first = steps.find((s) => s.warn && !s.idle);
  return first ? first.no : max;
}

/** 아직 남은 단계 수 — 「정리 끝 ✓」 옆 「🟡 N단계 남음」 */
export function remainingSteps(steps: WeeklyStep[]): number {
  return steps.filter((s) => s.warn && !s.idle).length;
}
