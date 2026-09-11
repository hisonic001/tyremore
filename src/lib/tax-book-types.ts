/**
 * ⭐ 계산서 화면 개편 — 정본(tax-book.ts)과 화면(tax-book-ui.tsx) 사이의 계약 (2026-09-11)
 *
 *   사장님 결정(설계서 「계산서 화면 개편」 §사장님 결정): 상대별 한 줄(B) · 한 장 = 한 카드 두 칸(누구 → 돈) ·
 *   매입·매출 한 화면 · 단추 넷([맞추기][경비][나중에][안 봄]) · 월정산은 거래처 한 줄(기준일 2026-08-25 + 시작 잔액) ·
 *   대행사는 장 단위 + 사슬 표시 · 앱 입고 합 한 칸 비교.
 *
 *   🔴 이 파일은 타입만 — 서버·클라이언트 공용. 값을 만드는 곳은 tax-book.ts 하나, 읽는 곳은 화면 하나.
 */

/** 화면 상태 색 — ✅ 끝 / 🟡 확인(앱 추측 있음, 한 번 눌러 끝) / ✖ 손 필요 / ⚪ 때 아님(기다림) */
export type Mark = "done" | "confirm" | "hand" | "wait";

export type PartyKind = "월정산" | "대행" | "경비" | "거래처" | "개인" | "무시";

/** 카드 「누구」 칸 */
export interface WhoCell {
  mark: Mark;
  /** 「거래처(사업자번호)」 「카랑 → 쏘카 대신 끊음」 「? — 처음 보는 상대」 */
  text: string;
  /** 대행사 사슬 — 「쏘카 8월 청구 2,132,898 (외상 12건) · 원단위 일치」 */
  chain?: { text: string; exact: boolean; href: string } | null;
  /** 앱 거래처와 이어졌나 (supplier.biz_no) */
  supplierId: number | null;
}

/** 통장 후보 한 줄 — 화면은 이걸로 [맞추기] 목록·체크 일괄을 그린다 */
export interface BankPick {
  cashTxnId: number;
  /** MM-DD */
  d: string;
  description: string;
  amount: number;
  /** 계산서와의 차이 (+ 통장이 더 많음) */
  diff: number;
  /** 「정확 일치」「이름 비슷」「수수료 차이 500」「이름 다름 — 확인」 */
  why: string;
  /** 확실(앱 추측 1개) — 체크 기본 ON */
  sure: boolean;
}

/** 카드 「돈」 칸 */
export interface MoneyCell {
  mark: Mark;
  /** 「✅ 8/31 출금 701,200」 「🟡 후보 1 — 8/31 출금 701,200 (+500)」 「✖ 통장에서 못 찾음」 「⚪ 아직 안 들어옴(보통 다음 달 말)」 */
  text: string;
  /** 이미 이어진 통장 줄(들) — 되돌리기용 */
  linked: { cashTxnId: number; d: string; amount: number }[];
  /** 남은 금액 (0이면 끝) */
  remain: number;
  /** 단일 후보들(체크 일괄용) — 확실한 것은 sure=true */
  picks: BankPick[];
  /** 여러 줄 합이 맞는 조합 — 있으면 한 단추로 */
  combo: { cashTxnIds: number[]; label: string; diff: number } | null;
  /** 통장 한 줄 = 계산서 N장 묶음 (이 카드가 그중 하나) */
  bundle: { cashTxnId: number; invoiceIds: number[]; label: string } | null;
  /** 수정(마이너스) 계산서 상쇄 — 원본 후보 */
  fix: { originId: number; label: string; auto: boolean } | null;
  /** 이 카드가 수정 계산서의 원본 — 상쇄가 먼저 */
  fixFirst: { minusId: number; label: string } | null;
}

export interface InvoiceCard {
  id: number;
  /** '매입' | '매출' */
  direction: "매입" | "매출";
  /** YYYY-MM-DD (write_date) */
  d: string;
  total: number;
  itemSummary: string | null;
  /** 'normal' | 'expense'(경비 규칙) | 'waiting'(나중에) | 'ignored'(안 봄) | 'fixed'(상쇄됨) */
  status: "normal" | "expense" | "waiting" | "ignored" | "fixed";
  who: WhoCell;
  money: MoneyCell;
  /** 카드 전체 상태 = who·money 중 나쁜 쪽 */
  mark: Mark;
  /** 앱이 알아서 끝낸 것인가(자동 맞춤·규칙) — 「앱이 알아서 맞춘 것」 접힘 목록으로 */
  auto: boolean;
}

/** 월정산 거래처 한 줄의 돈 셈 (기준일 이후 누적) */
export interface MonthlySummary {
  /** YYYY-MM-DD */
  baselineDate: string;
  baselineAmount: number;
  baselineNote: string | null;
  /** 기준일 이후 ~ 보는 달 말까지 */
  invoiced: number;
  paid: number;
  /** = baselineAmount + invoiced − paid (음수면 0 으로 보이고 paidPast 에) */
  remain: number;
  /** 기준일 이후 준 돈이 계산서보다 많을 때 그 초과분 — 「그 전 것 갚음」 */
  paidPast: number;
  /** 보는 달만 */
  monthInvoiced: number;
  monthPaid: number;
  /** 앱 매입 장부(입고) 같은 달 합 — 없으면 null */
  appReceived: number | null;
  /** 계산서 − 앱 입고 (양수면 앱에 안 넣은 매입) */
  appGap: number | null;
  /** 계산서·지급 줄 목록(펼침) */
  invoices: { id: number; d: string; total: number; status: InvoiceCard["status"] }[];
  payments: { cashTxnId: number; d: string; amount: number; description: string }[];
}

export interface PartyRow {
  /** 'B:사업자번호' 또는 'N:정규화이름' */
  key: string;
  bizNo: string | null;
  name: string;
  kind: PartyKind;
  /** 대행사면 누구 대신 끊는지 — 「쏘카·현대캐피탈」 */
  agencyFor: string | null;
  mark: Mark;
  /** 한 마디 — 「계산서 3장 4,245만 · 준 돈 4,199만 · 남은 46만」 「1장 3.9만 · 누구?」 */
  summary: string;
  count: number;
  total: number;
  /** 손이 필요한 장 수 / 확인 장 수 */
  handN: number;
  confirmN: number;
  cards: InvoiceCard[];
  /** 월정산 거래처만 */
  monthly: MonthlySummary | null;
  /** 앱 거래처 id (설정 → 거래처) */
  supplierId: number | null;
}

export interface TaxBook {
  ym: string;
  parties: PartyRow[];
  /** 「앱이 알아서 맞춘 것」 — 이 달 자동/규칙으로 끝난 카드 수와 되돌리기 재료 */
  autoDone: { cards: InvoiceCard[]; expenseN: number };
  /** 확인 층 — sure 후보가 있는 카드 id (체크 일괄) */
  confirmIds: number[];
  /** 기준일 전 정리 안 된 것 (원장에서 봄) */
  past: { n: number; amount: number; href: string };
  counts: { hand: number; confirm: number; done: number; partiesOpen: number };
}
