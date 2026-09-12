/**
 * ⭐ 「최근 한 일」 타입 계약 (개편 2단계, 2026-09-12) — 정본 fin-activity.ts · 기록 심는 코어 · 화면이 이 파일 하나를 본다.
 *
 *   표 fin_activity (scripts/add-fin-activity.ts): 돈관리에서 사람이 한 일 + 앱이 자동으로 한 일을 한 줄씩.
 *   되돌린 줄은 지우지 않고 undone_at 만 찍는다(회색 「되돌림」). 일괄은 한 줄에 n건 + items 로 접는다.
 *
 * 🔴 되돌리기는 **기존 undo 함수만** 부른다 — UndoKind 마다 어느 함수인지 fin-activity.ts 의 라우팅 표 하나.
 */

export const ACTIVITY_HOW = ["사람", "자동", "조정", "cron", "연간실행"] as const;
export type ActivityHow = (typeof ACTIVITY_HOW)[number];

export const ACTIVITY_VERB = [
  "대사", "되돌리기", "분류", "규칙", "보류", "제외", "수금", "지급", "마감", "올리기", "수정",
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERB)[number];

/** recon_match.method → how */
export function howOfMethod(method: string | null | undefined): ActivityHow {
  if (method === "자동") return "자동";
  if (method === "조정") return "조정";
  return "사람";
}

/**
 * 되돌리기 종류 → 기존 undo 함수 (fin-activity.ts 가 라우팅)
 *   tax         undoTaxMatch(taxInvoiceId, scope)          args { taxInvoiceId, scope?: "통장"|"앱"|"전부" }
 *   deposit     undoDepositLink(cashTxnId)                 args { cashTxnId }
 *   aside       markSaleSettledAside(quoteId, true)        args { quoteId }
 *   pay         undoPayFromWithdrawal(cashTxnId)           args { cashTxnId }
 *   payment     removePurchasePayment(id)                  args { paymentId }
 *   pos         unlinkMatch(matchId)                       args { matchId }
 *   expense     setExpenseCategory(id, null, {scope})      args { cashTxnId, scope? }
 *   depositKind undoDepositKind(cashTxnId)                 args { cashTxnId }
 *   cardSettle  unmarkCardSettlement(cashTxnId)            args { cashTxnId }
 *   collection  removeCollection(id)                       args { paymentId }
 *   taxRevive   ignoreTaxInvoice(id, true)                 args { taxInvoiceId }
 *   taxUnwait   markTaxWaiting(id, false)                  args { taxInvoiceId }
 *   monthly     undoMonthlyParty(bizNo, ym, dir)           args { bizNo, ym, direction }
 *   rule        removeTaxPartyRule(bizNo)                  args { bizNo }
 *   monthClose  reopenMonth(ym)                            args { ym }
 *   posClose    reopenPosDay(day)                          args { day }
 *   upload      cancelFinUpload(id)                        args { uploadId }
 *   skip        skipWithdrawal(id, true)                   args { cashTxnId }
 *   note        clearPosNote(ref)                          args { refTable, refId }
 *   ⭐ ruleOn   enableRuleCore(ruleKind, key, …)           args { ruleKind, key, value, label, raw?, partyKey? }
 *   ⭐ ruleOff  disableRuleCore(ruleKind, key)             args { ruleKind, key }
 *   bulk        items 각각을 위 종류로                      args { items: UndoItem[] }
 *
 * 🔴 ruleOn·ruleOff(개편 4단계, 2026-09-12)는 정본 party-rule.ts 의 쓰기 함수 **그 자체**다 —
 *    「규칙 저장」을 되돌리면 끄기, 「규칙 끄기」를 되돌리면 켜기. 새 되돌리기 논리가 아니다.
 */
export type UndoKind =
  | "tax" | "deposit" | "aside" | "pay" | "payment" | "pos" | "expense" | "depositKind" | "cardSettle"
  | "collection" | "taxRevive" | "taxUnwait" | "monthly" | "rule" | "monthClose" | "posClose" | "upload"
  | "skip" | "note" | "ruleOn" | "ruleOff" | "bulk";

export type UndoArgs = Record<string, string | number | boolean | null>;

/** 일괄(n건) 줄의 건별 되돌리기 항목 — undo_args.items */
export interface UndoItem {
  kind: Exclude<UndoKind, "bulk">;
  args: UndoArgs;
  label: string;
  amount?: number | null;
  /** 이 건만 되돌린 시각(ISO) — 전부 되돌리면 줄의 undone_at 도 찍힌다 */
  undone?: string | null;
}

export interface UndoSpec {
  kind: UndoKind;
  args: UndoArgs | { items: UndoItem[] };
}

/** logActivity() 입력 */
export interface ActivityEntry {
  /** 대상 달 YYYY-MM (마감 뒤 고침 판정에 씀). 없으면 오늘 달 */
  ym?: string | null;
  /** app_user.id — 앱이 한 일이면 null */
  actor?: number | null;
  how: ActivityHow;
  verb: ActivityVerb;
  target?: { table: string; id: number } | null;
  /** 일괄이면 건수 */
  n?: number;
  amount?: number | null;
  /** 사람이 읽는 한 줄 — 「입금 280,000 ↔ 미광전력 판매」 */
  label: string;
  undo?: UndoSpec | null;
}

/** 화면 한 줄 (recentActivity 결과) */
export interface ActivityRow {
  id: number;
  /** ISO */
  at: string;
  /** 「09-11 17:32」 KST */
  atLabel: string;
  ym: string | null;
  actor: number | null;
  actorName: string | null;
  how: ActivityHow;
  verb: ActivityVerb;
  targetTable: string | null;
  targetId: number | null;
  n: number;
  amount: number | null;
  label: string;
  undoKind: UndoKind | null;
  /** bulk 면 items 가 들어 있다 */
  undoItems: UndoItem[] | null;
  undoneAt: string | null;
  afterClose: boolean;
}

export interface ActivityDay {
  /** YYYY-MM-DD */
  d: string;
  rows: ActivityRow[];
}

/** 마감 뒤 고침 — 첫 화면 띠 */
export interface ClosedDelta {
  ym: string;
  /** after_close 줄 수(되돌린 것 제외) */
  n: number;
  closedProfit: number;
  nowProfit: number;
}
