/**
 * ⭐ ⑥ 지급 대조 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   payablesCardInfo(ym, suppliers).exact(거래처 축, exactPlan 원단위 일치·후보 유일)를 출금 축으로
 *   뒤집어 「짝 확실」로, payLinkData(ym).rows 를 suggest 유무로 「확인」/「손」으로.
 *   🔴 판정은 exactPlan·resolve 그대로. "use server" 아님.
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 A 가 채운다.
 */
import type { WeeklyPayableStep } from "./weekly-types";

export async function weeklyPayableStep(_ym: string): Promise<WeeklyPayableStep> {
  throw new Error("todo: 갈래 A — weeklyPayableStep");
}
