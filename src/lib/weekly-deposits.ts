/**
 * ⭐ ③ 입금 대조 — 「이번 주 정리」 단계 어댑터 (개편 3단계, 2026-09-12)
 *
 *   deposits/page.tsx:32-42 의 조립(depositReconData → depositTaxCandidates → depositSurePicks
 *   → arrangeDeposits + transferSalesMissing)을 여기로 옮겨 흐름 화면과 기존 화면이 **같은 것**을 쓴다.
 *   🔴 판정은 전부 정본 그대로 — 여기는 층으로 나눠 담기만 한다(partitionDeposits, 순수·시험 있음).
 *   🔴 "use server" 아님 — 조회 전용. 질의는 순차(풀 3).
 */
import type { WeeklyDepositStep } from "./weekly-types";
import { depositReconData } from "./recon-data";
import { arrangeDeposits, depositSurePicks, depositTaxCandidates, transferSalesMissing } from "./deposit-tax";
import { partitionDeposits } from "./weekly-deposits-pure";
import { autoActivity } from "./fin-activity";

export async function weeklyDepositStep(ym: string): Promise<WeeklyDepositStep> {
  const raw = await depositReconData(ym);
  // ⭐ 2026-08-26: 계산서 후보를 이 화면에서 바로 — 짝 확실 → 짝 있음 → 없음 순으로
  const { cands: taxCands, bundles } = await depositTaxCandidates(
    ym,
    raw.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sureMap = depositSurePicks(raw.open, taxCands, bundles);
  const { open, breakdown } = arrangeDeposits(raw.open, taxCands, sureMap, bundles);
  const data = { ...raw, open };
  // ⭐ 계좌이체로 적혔는데 법인 통장에 없는 판매 (개인 통장 입금 등, 사장님 제보 2026-08-26)
  const transfers = await transferSalesMissing(ym);
  // 3층 — sure 는 depositSurePicks 키 그대로(정본 Map 삽입 순서), 나머지는 후보 수로만 가른다
  const { sure, check, hand } = partitionDeposits(open, taxCands, bundles, sureMap.keys());
  // 「앱이 자동 대조한 것」 — fin_activity 되읽기 (confirmSureDeposits 의 bulk 한 줄 등)
  const auto = await autoActivity(ym, "대사");
  return { ym, data, taxCands, bundles, breakdown, transfers, sure, check, hand, auto };
}
