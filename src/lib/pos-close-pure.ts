/**
 * ⭐ 카드 일마감 — 순수 도우미 (개편 4단계, 2026-09-12)
 *
 * 🔴 이 파일은 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돌아야 해서 pos-close.ts 에서
 *    떼어냈다(weekly-deposits-pure·payables-plan 과 같은 이유). 카드 쪽은 시험이 0개였다.
 *
 *   담는 것: 조합 찾기(자동 대조 판정의 재료) · 안 된 날 고르기(첫 화면 「안 된 날 N일 →」과
 *   카드 화면 「다음 안 된 날 →」이 같은 규칙을 쓰게).
 */

/** 달력 한 날의 요약 — posDaysSummary 가 돌려주는 모양 */
export interface PosDaySummary {
  day: string;
  posCard: number;
  appCard: number;
  matched: number;
  open: number;
  closed: boolean;
}

/** 합이 target 이 되는 조합(2~3개)을 모두 찾는다 — 답이 하나일 때만 자동으로 쓴다 */
export function combosSummingTo<T extends { remain: number }>(items: T[], target: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].remain + items[j].remain === target) out.push([items[i], items[j]]);
      for (let k = j + 1; k < n; k++) {
        if (items[i].remain + items[j].remain + items[k].remain === target) out.push([items[i], items[j], items[k]]);
      }
    }
    if (out.length > 8) return out; // 너무 많으면 어차피 애매하다 — 그만 센다
  }
  return out;
}

/**
 * 마감 안 된 날 — 오늘을 맨 앞에, 나머지는 날짜 순.
 * (「이번 주 정리」 ② 카드 단계가 쓰던 정렬을 함수로 뽑은 것 — 세 화면이 같은 순서를 본다)
 */
export function sortOpenDays(days: PosDaySummary[], today: string): PosDaySummary[] {
  return days
    .filter((d) => !d.closed)
    .sort((a, b) => (a.day === today ? -1 : b.day === today ? 1 : a.day < b.day ? -1 : 1));
}

/**
 * 지금 보고 있는 날 말고 **다음으로 마감할 날**. 없으면 null.
 *   카드 화면의 「다음 안 된 날 →」과 첫 화면의 「안 된 날 N일 →」이 이걸 쓴다.
 *   current 를 비우면(첫 화면) 그냥 첫 번째 안 된 날이 나온다.
 */
export function nextOpenDay(days: PosDaySummary[], current: string | null, today: string): string | null {
  const open = sortOpenDays(days, today).filter((d) => d.day !== current);
  return open[0]?.day ?? null;
}
