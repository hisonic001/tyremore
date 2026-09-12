/**
 * ⭐ ⑥ 지급 대조 — 「이번 주 정리」 단계 (개편 3단계, 2026-09-12)
 *
 *   어댑터 weeklyPayableStep(ym) 을 **한 번** 부르고 클라이언트 PayablesFlow 에 넘긴다.
 *   거래처 카드(잔액·별명·손 지급)는 흐름에 안 쓴다 — 출금 축(WithdrawalRow)만.
 */
import { weeklyPayableStep } from "@/lib/weekly-payables";
import { PayablesFlow } from "./payables-flow";

export async function PayablesStep({ ym }: { ym: string }) {
  const step = await weeklyPayableStep(ym);
  return <PayablesFlow step={step} />;
}
