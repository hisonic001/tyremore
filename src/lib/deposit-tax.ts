/**
 * ⭐ 입금 화면에서 세금계산서 바로 잇기 (사장님 요청 2026-08-26 — 2026-01 입금 22건 중 13건이
 *    계산서 상대의 입금인데 "계산서 화면에서 이으세요"라고만 하고 버튼이 없었다)
 *
 *   입금 한 줄마다: 같은 상대(별명·이름 닮음)이거나 금액이 정확히 맞는 **열린 계산서**를 찾는다.
 *   매출 계산서 = 이 입금이 그 대금. 매입 계산서(★ 상대만) = 정산 입금에서 수수료를 뗀 상계(↔).
 *   「짝이 확실한 것」(정확 일치 + 아는 상대 하나뿐 / 이름 맞는 판매 하나뿐)은 한 번에 잇는다.
 *
 * 🔴 recon-data 는 tax-recon 이 가져다 쓰므로(순환 금지) 계산서 판별(CASH_LAT·DONE)을 쓰는
 *    이 계산은 별도 모듈에 둔다. "use server" 아님 — 페이지·액션이 부른다. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CASH_LAT, DONE } from "./tax-recon";
import { normName, samePartyName, similarPartyName, type DepositSuggestion } from "./recon-data";
import { monthRange } from "./ym";

const won = (n: number) => n.toLocaleString("ko-KR");

export interface DepositTaxCand {
  invId: number;
  direction: "매입" | "매출";
  label: string;
  /** 계산서에 남은 금액 = 입금 남은 금액 */
  exact: boolean;
  /** ★ 기억된 상대 또는 이름이 같은 상대 */
  known: boolean;
  similar: boolean;
  remain: number;
}

export type DepositTaxCands = Record<number, DepositTaxCand[]>;

export async function depositTaxCandidates(
  ym: string,
  deps: { id: number; date: string; amount: number; payerName: string }[],
): Promise<DepositTaxCands> {
  const out: DepositTaxCands = {};
  if (deps.length === 0) return out;
  const { start, nextStart } = monthRange(ym);
  // 열린 계산서(돈 확인 안 된 것) — 입금보다 최대 150일 앞, 45일 뒤까지
  const invs = await db.execute<{
    id: number; direction: "매입" | "매출"; d: string; name: string; biz: string; total: number; remain: string;
  }>(sql`
    SELECT t.id, t.direction, to_char(t.write_date, 'YYYY-MM-DD') d, t.counterparty_name name,
           t.counterparty_biz_no biz, t.total, (t.total - x.cov)::bigint remain
    FROM tax_invoice t ${CASH_LAT}
    WHERE t.is_active AND t.recon_status <> '무시' AND t.total > 0 AND NOT ${DONE}
      AND t.write_date >= ${start}::date - 150 AND t.write_date < ${nextStart}::date + 45
    ORDER BY t.write_date DESC LIMIT 1500
  `);
  const aliases = await db.execute<{ alias_key: string }>(sql`
    SELECT alias_key FROM party_alias WHERE party_key LIKE 'T:%' LIMIT 10000
  `);
  const aliasKeys = new Set(aliases.map((a) => a.alias_key));
  const DAY = 86400000;

  for (const dep of deps) {
    const pn = normName(dep.payerName);
    const t = new Date(dep.date).getTime();
    const cands = invs
      .map((inv) => {
        const known = aliasKeys.has(`${pn}@${inv.biz}`) || samePartyName(dep.payerName, inv.name);
        const similar = !known && similarPartyName(dep.payerName, inv.name);
        const remain = Number(inv.remain);
        const exact = remain === dep.amount;
        const w = new Date(inv.d).getTime();
        const inWindow = w >= t - 150 * DAY && w <= t + 45 * DAY;
        const ok = inWindow && (inv.direction === "매출" ? exact || known || similar : known);
        return { inv, known, similar, exact, remain, ok };
      })
      .filter((c) => c.ok)
      .sort(
        (a, b) =>
          Number(b.exact && b.known) - Number(a.exact && a.known) ||
          Number(b.exact) - Number(a.exact) ||
          Number(b.known) - Number(a.known) ||
          Number(b.similar) - Number(a.similar) ||
          Math.abs(new Date(a.inv.d).getTime() - t) - Math.abs(new Date(b.inv.d).getTime() - t),
      )
      .slice(0, 3)
      .map(({ inv, known, similar, exact, remain }) => ({
        invId: Number(inv.id),
        direction: inv.direction,
        label:
          `${inv.direction === "매입" ? "↔ " : ""}${known ? "★ " : similar ? "≈ " : ""}${inv.direction} ${inv.d.slice(2)} · ${inv.name.slice(0, 14)} · ${won(remain)}원` +
          (exact ? "" : ` · 입금보다 ${won(Math.abs(remain - dep.amount))}원 ${remain > dep.amount ? "큼" : "작음"}`) +
          (!known && !similar && exact ? " · 이름 다름 — 확인" : ""),
        exact,
        known,
        similar,
        remain,
      }));
    if (cands.length > 0) out[dep.id] = cands;
  }
  return out;
}

/** 짝이 확실한 입금 — 한 번에 이을 수 있는 것. 값 = 무엇과 이을지 */
export type SurePick = { kind: "tax"; invId: number } | { kind: "quote"; quoteId: number };

export function depositSurePicks(open: DepositSuggestion[], taxCands: DepositTaxCands): Map<number, SurePick> {
  const m = new Map<number, SurePick>();
  for (const s of open) {
    const tc = taxCands[s.dep.id] ?? [];
    const exact = tc.filter((c) => c.exact);
    const exactKnown = exact.filter((c) => c.known && c.direction === "매출");
    const q = s.quotes.filter((x) => x.nameOk);
    if (exactKnown.length === 1 && exact.length === 1) m.set(s.dep.id, { kind: "tax", invId: exactKnown[0].invId });
    // 이름 맞는 판매 하나뿐 — 금액만 같은 남의 계산서(이름 다름)는 방해하지 않는다 (늘푸른요양원 320,000)
    else if (q.length === 1 && exactKnown.length === 0) m.set(s.dep.id, { kind: "quote", quoteId: q[0].quoteId });
  }
  return m;
}

export interface DepositBreakdown {
  tax: number;
  quote: number;
  party: number;
  none: number;
}

/** 정렬(짝 확실 → 짝 있음 → 없음) + 분해 카운트 */
export function arrangeDeposits(
  open: DepositSuggestion[],
  taxCands: DepositTaxCands,
  sure: Map<number, SurePick>,
): { open: DepositSuggestion[]; breakdown: DepositBreakdown } {
  const rank = (s: DepositSuggestion) => {
    if (sure.has(s.dep.id)) return 0;
    if ((taxCands[s.dep.id]?.length ?? 0) > 0) return 1;
    if (s.quotes.length > 0 || s.parties.length > 0) return 2;
    return 3;
  };
  const sorted = [...open].sort((a, b) => rank(a) - rank(b) || (a.dep.date < b.dep.date ? 1 : -1));
  const breakdown: DepositBreakdown = { tax: 0, quote: 0, party: 0, none: 0 };
  for (const s of open) {
    if ((taxCands[s.dep.id]?.length ?? 0) > 0) breakdown.tax++;
    else if (s.quotes.length > 0) breakdown.quote++;
    else if (s.parties.length > 0) breakdown.party++;
    else breakdown.none++;
  }
  return { open: sorted, breakdown };
}
