/**
 * 「어떻게 알고 오셨어요?」 선택지 (마케팅 0단계, 2026-08-29)
 *
 * 광고 마케터 리뷰: 광고비 ÷ 그 달 신규 고객 수는 분모에 소개·지나가다·재방문이 다 섞여
 * 광고 효과를 크게 잘못 본다. 결제 때 한 번 묻는 것이 어떤 API 조합보다 정확하다.
 * 정비 화면·리포트가 이 목록 하나를 같이 쓴다 — 여기만 고치면 다 바뀐다.
 */
export const REFERRALS = ["네이버 검색", "플레이스(지도)", "소개", "지나가다", "재방문", "기타"] as const;
export type Referral = (typeof REFERRALS)[number];

export function isReferral(v: unknown): v is Referral {
  return typeof v === "string" && (REFERRALS as readonly string[]).includes(v);
}
