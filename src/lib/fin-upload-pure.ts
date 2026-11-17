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

/**
 * ⭐ 폴더 자동 업로드의 계정 이름 고르기 (2026-11-17, D-41)
 *
 *   화면에서는 사람이 「신한입금」 같은 계정 이름을 고른다. 자동 업로드는 **파일 이름**으로 고른다.
 *     ① 지정표(COLLECT_FIN_LABELS 「파일이름조각=계정」)에 걸리면 그것
 *     ② 이미 쓰는 계정 이름이 파일 이름 안에 **통째로** 들어 있으면 그것 (띄어쓰기·대소문자 무시)
 *        「신한 입금계좌 2026Q3.xlsx」 → 「신한입금」
 *   🔴 후보가 둘 이상이면 가장 긴 것 하나만 — 그래도 같은 길이로 둘이면 고르지 않는다(null).
 *      틀린 통장에 넣는 것보다 사람에게 넘기는 게 낫다.
 */
export function pickAccountLabel(
  fileName: string,
  labels: readonly string[],
  fixed: ReadonlyMap<string, string> = new Map(),
): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[\s_\-()[\]·.,]+/g, "");
  const f = norm(fileName);
  for (const [piece, label] of fixed) if (piece && f.includes(norm(piece))) return label;
  const hits = labels.filter((l) => norm(l).length >= 2 && f.includes(norm(l)));
  if (hits.length === 0) return null;
  const longest = Math.max(...hits.map((l) => norm(l).length));
  const top = hits.filter((l) => norm(l).length === longest);
  return top.length === 1 ? top[0] : null;
}
