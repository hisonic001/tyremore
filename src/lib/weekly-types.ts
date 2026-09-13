/**
 * ⭐ 「이번 주 정리」 흐름의 단계별 자료 모양 (개편 3단계, 2026-09-12)
 *
 *   각 단계는 3층으로 보여 준다 — 「앱이 자동 대조한 것」(접힘) / 「확인해 주세요」(추측 1개,
 *   체크 일괄) / 「손이 필요한 것」(검색·분류·수금 그 자리에서). 층 이름은 fin-words.ts.
 *
 * 🔴 여기엔 타입만 — 판정은 전부 기존 정본(depositSurePicks·exactPlan·taxBook…)이고,
 *    어댑터(weekly-*.ts)는 그 결과를 **층으로 나눠 담기만** 한다. 새 판정을 만들지 않는다.
 */
import type { DepositReconData, DepositSuggestion, ExpenseData, ExpenseRow, PayLinkRow, PayableSupplier } from "./recon-data";
import type { DepositBreakdown, DepositTaxBundles, DepositTaxCands, TransferSale } from "./deposit-tax";

/** 「앱이 자동 대조한 것」 한 줄 — fin_activity 를 되읽은 것 (되돌리기는 최근 한 일에서) */
export interface AutoLine {
  id: number;
  /** YYYY-MM-DD HH:MM */
  at: string;
  label: string;
  n: number;
  amount: number | null;
}

/* ── ③ 입금 대조 ─────────────────────────────────────────────── */
export interface WeeklyDepositStep {
  ym: string;
  /** depositReconData 결과(open 은 arrangeDeposits 순) — 카드·요약 한 줄·빈 상태가 쓴다 */
  data: DepositReconData;
  taxCands: DepositTaxCands;
  bundles: DepositTaxBundles;
  breakdown: DepositBreakdown;
  transfers: TransferSale[];
  /** 짝 확실 (depositSurePicks 키 그대로) — 체크 기본 ON, 일괄 = confirmSureDeposits(ym, ids) */
  sure: number[];
  /** 확인해 주세요 — 정본이 낸 후보가 딱 1개인 입금 */
  check: DepositSuggestion[];
  /** 손이 필요한 것 — 후보 여럿·없음·미수금 후보 */
  hand: DepositSuggestion[];
  auto: AutoLine[];
}

/* ── ④ 지출 분류 ─────────────────────────────────────────────── */
/** 같은 상대(payerKeyOf) 묶음 — 묶음 하나 = setExpenseCategory 한 번 (전파되므로 두 번 부르면 두 줄 기록) */
export interface WeeklyExpenseGroup {
  key: string;
  payer: string;
  suggest: string;
  ids: number[];
  anyId: number;
  n: number;
  sum: number;
}
export interface WeeklyExpenseStep {
  ym: string;
  data: ExpenseData;
  check: WeeklyExpenseGroup[];
  hand: ExpenseRow[];
  auto: AutoLine[];
}

/* ── ⑥ 지급 대조 ─────────────────────────────────────────────── */
/** 출금 한 줄이 어느 거래처 인보이스와 원단위로 맞는가 — payablesCardInfo().exact 를 출금 축으로 뒤집은 것 */
export interface SureWithdrawal {
  cashTxnId: number;
  /** YYYY-MM-DD */
  day: string;
  amount: number;
  supplier: string;
  invoiceNos: string[];
}
/**
 * 거래처 카드(「거래처별 자세히」 접힘)가 쓰는 payablesCardInfo 의 일부 — 개편 5단계(2026-09-13).
 *   taxOkN·taxOkSum = ✅지급 확인 조건(대조 완료 계산서 합이 잔액을 덮을 때만), deposit = 선급금.
 *   ⚡낱건 exact·별명(aliases)·준 돈 합계는 카드에서 뺐으므로 안 담는다.
 */
export interface PayableCardLite {
  taxOkN: number;
  taxOkSum: number;
  deposit: number;
}
export interface WeeklyPayableStep {
  ym: string;
  sure: SureWithdrawal[];
  /** suggest 있음 — 거래처는 알겠는데 금액이 딱 안 맞는 것 */
  check: PayLinkRow[];
  /** suggest 없음 */
  hand: PayLinkRow[];
  supplierNames: string[];
  remainBySup: Record<string, number>;
  totalRemain: number;
  auto: AutoLine[];
  /** 미지급 잔액이 있는 거래처(매입별 잔액 포함) — 거래처 카드의 손 지급 폼·매입별 잔액·✅지급 확인 (5단계) */
  suppliers: PayableSupplier[];
  /** 거래처 이름 → 카드 잔여 정보. 선급금만 남은 거래처(잔액 0)도 든다 — payablesCardInfo 결과 그대로 */
  cardsLite: Record<string, PayableCardLite>;
}
