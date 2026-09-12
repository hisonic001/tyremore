/**
 * ⭐ 「이번 주 정리」 흐름의 단계별 자료 모양 (개편 3단계, 2026-09-12)
 *
 *   각 단계는 3층으로 보여 준다 — 「앱이 자동 대조한 것」(접힘) / 「확인해 주세요」(추측 1개,
 *   체크 일괄) / 「손이 필요한 것」(검색·분류·수금 그 자리에서). 층 이름은 fin-words.ts.
 *
 * 🔴 여기엔 타입만 — 판정은 전부 기존 정본(depositSurePicks·exactPlan·taxBook…)이고,
 *    어댑터(weekly-*.ts)는 그 결과를 **층으로 나눠 담기만** 한다. 새 판정을 만들지 않는다.
 */
import type { DepositReconData, DepositSuggestion, ExpenseData, ExpenseRow, PayLinkRow } from "./recon-data";
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
  /** deposits/page.tsx 가 넘기던 그대로 — DepositsRecon 프롭 호환 */
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
}
