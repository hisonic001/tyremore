/**
 * ⭐ 돈관리 용어 정본 (개편 2단계, 2026-09-12) — 화면 글자는 전부 여기서 가져온다.
 *
 *   사장님(09-11): "좀 더 한국의 ERP 기준으로 생각해서 깔끔하고 명료한 단어가 필요함",
 *   "「반제」는 어려움 — 「지급 확인」으로", 손익 세 줄은 "매출 · 비용 · 이익으로".
 *   하루 써 보시고(09-12) "「대사」가 여기저기 쓰인 게 어색함" → **「대조」**로 바꿈(앱 안 DB 값 '미대조'와도 같은 말).
 *
 *   국내 ERP(더존·영림원) 관행을 따른다: 잇기·맞추기·붙이기 → **대조**, 자국 → 대조 내역,
 *   확정 → 대조 완료, 미대조 → 미대조(그대로), 제안 → 대조 후보, 이을 것 없음 → 대조 제외,
 *   도장 찍기 → **지급 확인**, 예치금 → 선급금, 나중에·대기 → 보류, 무시·안 봄 → 제외,
 *   상쇄 → 상계, 컷오프 → 자료 기준일, 못 받은 돈 → 미수금, 줄 돈 → 미지급금.
 *
 * 🔴 DB 값(recon_status '미대조/제안/확정/무시/대기', recon_match.method '자동/수동/조정')은 그대로다 —
 *    바꾸는 건 **화면 글자**뿐. 값 → 글자는 `statusWord()` 로.
 * 🔴 새 낱말이 필요하면 여기에 더하고 화면에서는 `W.xxx` 로 쓴다. 화면 파일에 글자를 직접 박지 않는다.
 */

export const W = {
  /** 잇기·맞추기·붙이기 */
  recon: "대조",
  reconDeposit: "입금 대조",
  reconTax: "계산서 대조",
  reconPay: "지급 대조",
  reconCard: "카드 대조",
  /** 자국·연결·맞춘 기록 */
  reconLog: "대조 내역",
  /** 확정 */
  done: "대조 완료",
  /** 미대조·확인 필요 */
  open: "미대조",
  /** 제안·추천·앱 추측 */
  candidate: "대조 후보",
  /** 이을 것 없음·건너뜀·짝 없음 */
  excluded: "대조 제외",
  /** 나중에·대기·기다림 */
  hold: "보류",
  /** 안 봄·무시·정리(무시) */
  ignore: "제외",
  /** 도장 찍기·이미 준 돈으로 정리 */
  payConfirm: "지급 확인",
  /** 예치금·미리 준 돈 */
  prepaid: "선급금",
  /** 상쇄·서로 지움 */
  offset: "상계",
  /** 컷오프 */
  cutoff: "자료 기준일",
  /** 못 받은 돈·받을 돈·외상 */
  receivable: "미수금",
  /** 줄 돈 */
  payable: "미지급금",
  collect: "수금",
  monthly: "월정산",
  undo: "되돌리기",
  undone: "되돌림",
  /** 손익 세 줄 (번 돈·쓴 돈·남은 돈) */
  sales: "매출",
  cost: "비용",
  profit: "이익",
  /** 최근 한 일 화면 */
  activity: "최근 한 일",
  activityUndoHere: "최근 한 일에서 되돌리기 →",
  /** 3층 배치 머리말 */
  tierAuto: "앱이 자동 대조한 것",
  tierCheck: "확인해 주세요",
  tierHand: "손이 필요한 것",
  /** 확실 층 — 앱이 짝을 확신하는 것(체크 기본 ON) */
  tierSure: "짝 확실",
  /** ⭐ 「이번 주 정리」 한 줄 흐름 (개편 3단계, 2026-09-12) */
  weekly: "이번 주 정리",
  stepDone: "이 단계 끝",
  next: "다음",
  prev: "이전",
  weeklyDone: "이번 주 정리 끝",
  lastDone: "마지막 정리",
  goRegisterSale: "정비 내역에 등록하러",
  backToWeekly: "이번 주 정리로 돌아가기",
  pcOnly: "PC 에서 하는 일입니다",
  /** ⭐ 붙이기 자동화·규칙 학습 (개편 4단계, 2026-09-12; 결정 7 ①③) */
  learnNext: "다음부터 자동으로",
  bulkNoLearn: "이번 일괄은 규칙 학습 안 함",
  rules: "자동 규칙",
  ruleOff: "끄기",
  ruleOn: "켜기",
  ruleSaved: "규칙 저장",
  ruleRemoved: "규칙 끄기",
  codeRules: "앱 기본 규칙",
  autoRecon: "자동 대조",
  nextOpenDay: "다음 안 된 날",
} as const;

/** 「짝이 확실한 N건 모두 잇기」 → 「자동 대조 N건」 */
export function autoReconLabel(n: number): string {
  return `자동 대조 ${n}건`;
}

/**
 * DB recon_status 값 → 화면 글자. 뱃지 한 벌(components/fin/badge.tsx)이 이걸 쓴다.
 * '대기' 가 전에는 빠져서 날것으로 나왔다 — 여기서 「보류」.
 */
export const STATUS_WORD: Record<string, string> = {
  미대조: W.open,
  제안: W.candidate,
  확정: W.done,
  무시: W.ignore,
  대기: W.hold,
};

export function statusWord(status: string | null | undefined): string {
  if (!status) return W.open;
  return STATUS_WORD[status] ?? status;
}

/** recon_match.method(자동/수동/조정) → 「누가」 글자 */
export const METHOD_WORD: Record<string, string> = {
  자동: "앱이 자동",
  수동: "사장님",
  조정: "앱이 조정",
};

/**
 * fin_activity.verb(DB 값) → 화면 글자. 「최근 한 일」 배지가 이걸 쓴다.
 *   🔴 DB CHECK 값은 '대사' 그대로다(고치면 기존 줄이 깨진다) — 화면 글자만 「대조」.
 */
export const VERB_WORD: Record<string, string> = {
  대사: W.recon,
};

export function verbWord(verb: string | null | undefined): string {
  if (!verb) return "";
  return VERB_WORD[verb] ?? verb;
}
