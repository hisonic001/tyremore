/**
 * ⭐ 돈관리 용어 정본 (개편 2단계, 2026-09-12) — 화면 글자는 전부 여기서 가져온다.
 *
 *   사장님(09-11): "좀 더 한국의 ERP 기준으로 생각해서 깔끔하고 명료한 단어가 필요함",
 *   "「대사」는 좋은데 「반제」는 어려움 — 「지급 확인」으로", 손익 세 줄은 "매출 · 비용 · 이익으로".
 *
 *   국내 ERP(더존·영림원) 관행을 따른다: 잇기·맞추기·붙이기 → **대사**, 자국 → 대사 내역,
 *   확정 → 대사 완료, 미대조 → 미대사, 제안 → 대사 후보, 이을 것 없음 → 대사 제외,
 *   도장 찍기 → **지급 확인**, 예치금 → 선급금, 나중에·대기 → 보류, 무시·안 봄 → 제외,
 *   상쇄 → 상계, 컷오프 → 자료 기준일, 못 받은 돈 → 미수금, 줄 돈 → 미지급금.
 *
 * 🔴 DB 값(recon_status '미대조/제안/확정/무시/대기', recon_match.method '자동/수동/조정')은 그대로다 —
 *    바꾸는 건 **화면 글자**뿐. 값 → 글자는 `statusWord()` 로.
 * 🔴 새 낱말이 필요하면 여기에 더하고 화면에서는 `W.xxx` 로 쓴다. 화면 파일에 글자를 직접 박지 않는다.
 */

export const W = {
  /** 잇기·맞추기·붙이기 */
  recon: "대사",
  reconDeposit: "입금 대사",
  reconTax: "계산서 대사",
  reconPay: "지급 대사",
  reconCard: "카드 대사",
  /** 자국·연결·맞춘 기록 */
  reconLog: "대사 내역",
  /** 확정 */
  done: "대사 완료",
  /** 미대조·확인 필요 */
  open: "미대사",
  /** 제안·추천·앱 추측 */
  candidate: "대사 후보",
  /** 이을 것 없음·건너뜀·짝 없음 */
  excluded: "대사 제외",
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
  tierAuto: "앱이 자동 대사한 것",
  tierCheck: "확인해 주세요",
  tierHand: "손이 필요한 것",
} as const;

/** 「짝이 확실한 N건 모두 잇기」 → 「자동 대사 N건」 */
export function autoReconLabel(n: number): string {
  return `자동 대사 ${n}건`;
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
