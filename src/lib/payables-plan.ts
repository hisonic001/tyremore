/**
 * ⭐ 원단위 자동 잇기 규칙 — 순수 계산 (2026-08-31)
 *
 * 🔴 이 파일은 DB 를 건드리지 않는다 — 시험(npm test)이 DB 없이 돌아야 해서
 *    payables-view(DB 포함)에서 분리했다 (expense-cats 와 같은 이유).
 *    출금 남은 돈이 ①인보이스 하나 ②같은 작성일 묶음 합과 **원단위까지** 일치할 때만
 *    잇기를 제안한다. 근사치 제안은 없다 — 돈은 정확히 맞아야 한다.
 */
export function exactPlan(
  amount: number,
  invoices: { id: number; no: string; d: string | null; remain: number }[],
): { ids: number[]; nos: string[] } | null {
  const open = invoices.filter((i) => i.remain > 0);
  const one = open.find((i) => i.remain === amount);
  if (one) return { ids: [one.id], nos: [one.no] };
  const byDay = new Map<string, typeof open>();
  for (const i of open) {
    const k = i.d ?? "?";
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  for (const g of byDay.values()) {
    if (g.length > 1 && g.reduce((s, i) => s + i.remain, 0) === amount) {
      return { ids: g.map((i) => i.id), nos: g.map((i) => i.no) };
    }
  }
  return null;
}
