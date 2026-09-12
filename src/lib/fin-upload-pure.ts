/**
 * ⭐ 올린 파일이 말하는 달 (2026-09-10 → 개편 4단계에서 순수 파일로 뗌, 2026-09-12)
 *
 * 🔴 **조회기간(periodTo)이 아니라 줄이 가장 많은 달**을 쓴다. 월초에 지난달 통장을 받으면
 *    조회기간 끝은 이번 달(예: 09-03)인데 내용은 전부 지난달이라, 기간으로 데려가면
 *    빈 화면이 나온다 (전엔 아예 「보고 있던 달」로 데려가 같은 증상이었다).
 *    같은 수면 늦은 달 — 달을 걸친 파일은 새 달을 정리하러 가는 게 자연스럽다.
 *
 * ⭐ 4단계: 「올린 직후 자동 대조」가 **파일이 건드린 달 전부**를 봐야 해서 목록(yms)도 함께 돌려준다.
 *    best 는 지금까지처럼 「다음 화면이 보여줄 달」 하나.
 * 🔴 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돈다.
 */

export interface YmsOfRows {
  /** 다음 화면이 보여줄 달 — 줄이 가장 많은 달(같으면 늦은 달) */
  best: string | null;
  /** 파일이 건드린 달 — 줄 많은 순. 자동 대조가 이 목록을 돈다 */
  yms: string[];
}

export function ymsOfRows(dates: readonly string[], fallback: string | null): YmsOfRows {
  const n = new Map<string, number>();
  for (const d of dates) {
    const ym = String(d ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) n.set(ym, (n.get(ym) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [ym, c] of n) {
    if (best === null || c > (n.get(best) ?? 0) || (c === n.get(best) && ym > best)) best = ym;
  }
  // 줄 많은 순 → 같으면 늦은 달 (best 와 같은 기준)
  const yms = [...n.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : b[0].localeCompare(a[0]))).map(([ym]) => ym);
  if (best) return { best, yms };
  const f = String(fallback ?? "").slice(0, 7);
  const ok = /^\d{4}-\d{2}$/.test(f);
  return { best: ok ? f : null, yms: ok ? [f] : [] };
}
