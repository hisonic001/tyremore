/**
 * ⭐ MARS 자동 입력이 쓰는 작은 규칙들 — 순수 함수 (2026-11-18 로그 점검에서 나온 것)
 *   🔴 "use server" 아님 — scripts/mars-fill.ts 와 시험이 같이 쓴다.
 */

/**
 * 등록 날짜 — 사장님 방식 「오늘 날짜에서 연도만 그 해로」. 🔴 **오늘보다 뒤로는 안 넣는다.**
 *   2027년식 신차(2026-11 출고)에 2027-11-18 을 넣었더니 MARS 가 저장을 막았다
 *   (임규리 테슬라 모델 Y, 11-13~11-18 16번 실패). 연식이 올해보다 크면 오늘 날짜.
 */
export function marsRegDate(year: number, today: string): string {
  const d = `${year}${today.slice(4)}`;
  return d > today ? today : d;
}

/**
 * MARS 고객 검색에 넣을 이름 후보 — 원래 이름, 그다음 괄호 붙임을 뗀 이름.
 *   우리 앱 이름엔 「박준현[대순진리회]」처럼 소속을 붙여 두는데 MARS 에는 그 글자가 없어
 *   검색이 0건이었다(11-17~11-18 7번 실패).
 */
export function marsNameCandidates(name: string): string[] {
  const raw = name.trim();
  const bare = raw.replace(/\s*[\[(（【<].*?[\])）】>]\s*/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([raw, bare].filter(Boolean))];
}

/** 같은 이유로 몇 번 실패하면 대기열에서 내리나 — 끝없이 재시도하며 MARS 에 흔적을 남기지 않게 */
export const SAME_FAIL_LIMIT = 3;

/** 실패 문구를 비교용으로 — 앞부분만, 숫자·번호판 같은 건 그대로 둔다 */
export function failKey(msg: string): string {
  return msg.replace(/\s+/g, " ").trim().slice(0, 40);
}
