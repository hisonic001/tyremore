/**
 * ⭐ ③ 입금 대조 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   deposits/page.tsx:32-40 의 조립 4줄(depositReconData → depositTaxCandidates → depositSurePicks
 *   → arrangeDeposits)을 여기로 옮겨 흐름 화면과 기존 화면이 **같은 것**을 쓴다.
 *   🔴 판정은 전부 정본 그대로 — 여기는 층으로 나눠 담기만 한다.
 * 🔴 "use server" 아님 — 조회 전용.
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 A 가 채운다.
 */
import type { WeeklyDepositStep } from "./weekly-types";

export async function weeklyDepositStep(_ym: string): Promise<WeeklyDepositStep> {
  throw new Error("todo: 갈래 A — weeklyDepositStep");
}
