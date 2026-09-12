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

/**
 * ⭐ 거래처 축 → 출금 축 뒤집기 (개편 3단계 ⑥, 2026-09-12)
 *
 *   payablesCardInfo(ym, suppliers)[sup].exact 는 「이 거래처의 어느 출금이 어느 인보이스와 원단위로
 *   맞는가」(거래처 카드용). 「이번 주 정리」 흐름은 출금 한 줄씩 체크하므로 출금 축으로 뒤집는다.
 *   🔴 판정은 exactPlan 그대로 — 여기서는 모양만 바꾼다. 같은 출금이 두 거래처에, 같은 인보이스가
 *      두 출금에 가는 일은 payablesCardInfo 가 이미 막지만(remain=0 처리), 순수 함수 쪽에서도
 *      한 번 더 거른다(먼저 온 것이 이긴다) — 실행은 어차피 autoLinkExactCore 가 FOR UPDATE 로 재검사.
 *   · day: ExactSuggest.day 는 'MM-DD'(payables-view 의 to_char) — ym 의 연도를 붙여 'YYYY-MM-DD' 로.
 *   · 순서: 날짜 → cashTxnId (화면이 날짜순으로 보이게).
 */
export function flipExact(
  cards: Record<string, { exact: { cashTxnId: number; day: string; amount: number; invoiceNos: string[] }[] }>,
  ym: string,
): { cashTxnId: number; day: string; amount: number; supplier: string; invoiceNos: string[] }[] {
  const year = ym.slice(0, 4);
  const seenCash = new Set<number>();
  const seenInv = new Set<string>();
  const out: { cashTxnId: number; day: string; amount: number; supplier: string; invoiceNos: string[] }[] = [];
  for (const [supplier, info] of Object.entries(cards)) {
    for (const e of info.exact ?? []) {
      if (seenCash.has(e.cashTxnId)) continue;
      const keys = e.invoiceNos.map((no) => `${supplier}|${no}`);
      if (keys.some((k) => seenInv.has(k))) continue;
      seenCash.add(e.cashTxnId);
      for (const k of keys) seenInv.add(k);
      const day = /^\d{2}-\d{2}$/.test(e.day) ? `${year}-${e.day}` : e.day;
      out.push({ cashTxnId: e.cashTxnId, day, amount: e.amount, supplier, invoiceNos: [...e.invoiceNos] });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.cashTxnId - b.cashTxnId));
}
