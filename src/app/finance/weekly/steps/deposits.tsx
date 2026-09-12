/**
 * ⭐ ③ 입금 대조 — 「이번 주 정리」 단계 (개편 3단계, 2026-09-12)
 *
 *   어댑터 weeklyDepositStep(ym) 을 **한 번** 부르고(풀 3 — 한 요청에 한 단계) 클라이언트 DepositsFlow 에 넘긴다.
 *   헤더·진행막대·이전/다음은 page.tsx·nav.tsx 몫 — 여기서는 안 그린다.
 */
import { weeklyDepositStep } from "@/lib/weekly-deposits";
import { DepositsFlow } from "./deposits-flow";

export async function DepositsStep({ ym }: { ym: string }) {
  const step = await weeklyDepositStep(ym);
  return <DepositsFlow step={step} />;
}
