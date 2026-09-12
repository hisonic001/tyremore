/**
 * ⭐ ⑥ 지급 대조 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   payablesCardInfo(ym, suppliers).exact(거래처 축, exactPlan 원단위 일치·후보 유일)를 출금 축으로
 *   뒤집어(flipExact, 순수·시험 있음) 「짝 확실」로, payLinkData(ym).rows 를 suggest 유무로 「확인」/「손」으로.
 *   확실층에 든 출금은 확인·손층에서 뺀다(한 출금은 한 층에만).
 *   🔴 판정은 exactPlan·resolve 그대로. 실행(confirmSureWithdrawals)은 서버가 이 함수를 다시 불러 재계산한다.
 *   🔴 payables/page.tsx 가 더 부르는 bankPayerOptions·taxCashData 는 흐름에 필요 없어 안 부른다(풀 3).
 *   🔴 "use server" 아님.
 */
import type { WeeklyPayableStep } from "./weekly-types";
import { payLinkData, payablesData, type PayLinkRow } from "./recon-data";
import { payablesCardInfo } from "./payables-view";
import { flipExact } from "./payables-plan";
import { autoActivity } from "./fin-activity";

export async function weeklyPayableStep(ym: string): Promise<WeeklyPayableStep> {
  const data = await payablesData();
  const cards = await payablesCardInfo(ym, data.suppliers.map((s) => s.supplier));
  const sure = flipExact(cards, ym);
  const sureIds = new Set(sure.map((s) => s.cashTxnId));

  const links = await payLinkData(ym);
  const check: PayLinkRow[] = [];
  const hand: PayLinkRow[] = [];
  for (const row of links.rows) {
    if (sureIds.has(row.id)) continue;
    (row.suggest !== null ? check : hand).push(row);
  }

  const remainBySup: Record<string, number> = {};
  for (const s of data.suppliers) remainBySup[s.supplier] = s.remain;

  const auto = await autoActivity(ym, "지급");
  return {
    ym,
    sure,
    check,
    hand,
    supplierNames: links.supplierNames,
    remainBySup,
    totalRemain: data.totalRemain,
    auto,
  };
}
