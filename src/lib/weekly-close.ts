/**
 * ⭐ ⑦ 지난달 마감 — 체크리스트를 「이번 주 정리」 단계에서 만든다 (개편 3단계, 2026-09-12)
 *
 *   전에는 마감 체크리스트(month-close.closeChecklist)가 9줄을 **자기 손으로 다시** 만들었다.
 *   같은 정본 함수를 쓰긴 했지만 목록이 두 벌이라, 계산서는 taxOpenCount(단수) vs taxOpenCounts(복수),
 *   미지급은 payablesData vs payableTotal 로 미세하게 갈렸다. 이제 weeklySteps 한 벌에서 뽑는다.
 *
 *   🔴 마감 판정은 바뀌지 않는다 — 마감을 막는 hard 3항목(입금·지출·계산서)은 weeklySteps 가
 *      **같은 함수**(depositOpenCount·expenseOpen·taxOpenCounts = taxOpenCount 의 buy+sell)로 센다.
 *      soft(참고) 항목은 ⚠ 만 보이고 closeMonth 의 「soft 아닌 미충족 거부」 필터는 그대로다.
 *   · posclose(카드 일마감 안 된 날) 항목은 없앴다 — 카드 단계 status 에 「안 된 날 N일」이 이미 있고 soft 였다.
 *
 * 🔴 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돌아야 해서 순수 함수만.
 */
import type { WeeklySteps, WeeklyStepKey } from "./weekly-steps";
import type { CloseCheck } from "./month-close";

/** 단계 → 마감을 막는가. 자료·카드·미지급은 참고(soft), 입금·지출·계산서는 필수(hard) */
const HARD: Record<Exclude<WeeklyStepKey, "close">, boolean> = {
  upload: false,
  card: false,
  deposits: true,
  expenses: true,
  tax: true,
  payables: false,
};

export function closeChecksOf(w: WeeklySteps, extra: { zero: CloseCheck | null; health: CloseCheck }): CloseCheck[] {
  const out: CloseCheck[] = [];
  for (const s of w.steps) {
    if (s.key === "close") continue; // 마감 단계 자체는 체크 항목이 아니다
    const hard = HARD[s.key];
    out.push({
      key: s.key,
      ok: !s.warn,
      text: s.status,
      href: s.href,
      ...(hard ? {} : { soft: true }),
    });
  }
  if (extra.zero) out.push(extra.zero);
  out.push(extra.health);
  return out;
}
