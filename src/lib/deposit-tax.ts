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
import { CASH_LAT, DONE, findAmountComboNear, nearTolerance } from "./tax-recon";
import { cashUsedSql, normName, samePartyName, similarPartyName, type DepositSuggestion } from "./recon-data";
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

/** 입금 한 줄 = 이 상대 계산서 여러 장 합 (레드캡 624,800 = 528,000 + 96,800) — 한 번에 잇는다 */
export interface DepositTaxBundle {
  invoiceIds: number[];
  parts: string[];
  total: number;
  /** 합 − 입금 (허용 오차 안, 0이면 정확) */
  diff: number;
}
export type DepositTaxBundles = Record<number, DepositTaxBundle>;

export async function depositTaxCandidates(
  ym: string,
  deps: { id: number; date: string; amount: number; payerName: string }[],
): Promise<{ cands: DepositTaxCands; bundles: DepositTaxBundles }> {
  const out: DepositTaxCands = {};
  const bundles: DepositTaxBundles = {};
  if (deps.length === 0) return { cands: out, bundles };
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
    const scored = invs
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
      );
    /* 묶음 — 정확히 맞는 한 장이 없을 때, 아는 상대(★·≈)의 매출 계산서 여러 장 합이 입금과 맞으면 */
    if (!scored.some((c) => c.exact)) {
      const pool = scored
        .filter((c) => c.inv.direction === "매출" && (c.known || c.similar) && c.remain > 0)
        .map((c) => ({ id: Number(c.inv.id), amount: c.remain, label: `${c.inv.d.slice(5)} ${won(c.remain)}원` }));
      const combo = findAmountComboNear(pool, dep.amount, nearTolerance(dep.amount));
      if (combo) {
        bundles[dep.id] = {
          invoiceIds: combo.picks.map((c) => c.id),
          parts: combo.picks.map((c) => c.label),
          total: combo.sum,
          diff: combo.sum - dep.amount,
        };
      }
    }
    const cands = scored
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
  return { cands: out, bundles };
}

/** 짝이 확실한 입금 — 한 번에 이을 수 있는 것. 값 = 무엇과 이을지 */
export type SurePick =
  | { kind: "tax"; invId: number }
  | { kind: "quote"; quoteId: number }
  | { kind: "bundle"; invoiceIds: number[] };

export function depositSurePicks(
  open: DepositSuggestion[],
  taxCands: DepositTaxCands,
  bundles: DepositTaxBundles = {},
): Map<number, SurePick> {
  const m = new Map<number, SurePick>();
  for (const s of open) {
    const tc = taxCands[s.dep.id] ?? [];
    const exact = tc.filter((c) => c.exact);
    const exactKnown = exact.filter((c) => c.known && c.direction === "매출");
    const q = s.quotes.filter((x) => x.nameOk);
    const b = bundles[s.dep.id];
    if (exactKnown.length === 1 && exact.length === 1) m.set(s.dep.id, { kind: "tax", invId: exactKnown[0].invId });
    else if (b && b.diff === 0 && exact.length === 0 && q.length === 0) m.set(s.dep.id, { kind: "bundle", invoiceIds: b.invoiceIds });
    // 이름 맞는 판매 하나뿐 — 금액만 같은 남의 계산서(이름 다름)는 방해하지 않는다 (늘푸른요양원 320,000)
    else if (q.length === 1 && exactKnown.length === 0) m.set(s.dep.id, { kind: "quote", quoteId: q[0].quoteId });
  }
  return m;
}

/**
 * ⭐ 앱엔 「계좌이체」로 적혔는데 법인 통장에 입금이 없는 판매 (사장님 제보 2026-08-26 — "이체한다고 하고
 *    개인 통장으로 보내는 손님이 더러 있다"). 입금 화면에서 [개인 통장으로 받음]·[현금으로 받음]·[아직 안 들어옴]
 *    한 번으로 정리하고, 같은 금액 입금이 있으면 바로 잇는다.
 */
export interface TransferSale {
  key: string;
  quoteId: number;
  quoteNo: string;
  who: string;
  amount: number;
  day: string;
  note: { reason: string; memo: string | null } | null;
  cands: { cashId: number; label: string }[];
}

export async function transferSalesMissing(ym: string): Promise<TransferSale[]> {
  const { start, nextStart } = monthRange(ym);
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const rows = await db.execute<{ id: number; quote_no: string; who: string; total: number; d: string; reason: string | null; memo: string | null }>(sql`
    SELECT q.id, q.quote_no, COALESCE(q.supplier_name, c.name, '손님') who, q.total_amount total, to_char(${D}, 'YYYY-MM-DD') d,
           n.reason, n.memo
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN pos_note n ON n.kind = 'transfer' AND n.ref = 'quote:' || q.id
    WHERE q.status = '성사' AND q.payment_method = '계좌이체' AND q.total_amount > 0
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
      AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id AND m.status = '확정')
    ORDER BY ${D} DESC, q.id DESC LIMIT 100
  `);
  const out: TransferSale[] = [];
  for (const r of rows) {
    const cands = await db.execute<{ id: number; d: string; description: string }>(sql`
      SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') d, c.description
      FROM cash_txn c
      WHERE c.source = '통장' AND c.is_active AND c.category IS NULL AND c.in_amount = ${Number(r.total)}
        AND c.in_amount > ${cashUsedSql("c")}
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${r.d}::date - 3 AND ${r.d}::date + 3
      ORDER BY abs((c.occurred_at AT TIME ZONE 'Asia/Seoul')::date - ${r.d}::date) LIMIT 3
    `);
    out.push({
      key: `quote:${r.id}`,
      quoteId: Number(r.id),
      quoteNo: r.quote_no,
      who: r.who,
      amount: Number(r.total),
      day: r.d,
      note: r.reason ? { reason: r.reason, memo: r.memo } : null,
      cands: cands.map((c) => ({ cashId: Number(c.id), label: `${c.d} · ${c.description.replace(/^\[[^\]]*\]\s*/, "")} · +${won(Number(r.total))}원` })),
    });
  }
  return out;
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
  bundles: DepositTaxBundles = {},
): { open: DepositSuggestion[]; breakdown: DepositBreakdown } {
  const rank = (s: DepositSuggestion) => {
    if (sure.has(s.dep.id)) return 0;
    if ((taxCands[s.dep.id]?.length ?? 0) > 0 || bundles[s.dep.id]) return 1;
    if (s.quotes.length > 0 || s.parties.length > 0) return 2;
    return 3;
  };
  const sorted = [...open].sort((a, b) => rank(a) - rank(b) || (a.dep.date < b.dep.date ? 1 : -1));
  const breakdown: DepositBreakdown = { tax: 0, quote: 0, party: 0, none: 0 };
  for (const s of open) {
    if ((taxCands[s.dep.id]?.length ?? 0) > 0 || bundles[s.dep.id]) breakdown.tax++;
    else if (s.quotes.length > 0) breakdown.quote++;
    else if (s.parties.length > 0) breakdown.party++;
    else breakdown.none++;
  }
  return { open: sorted, breakdown };
}
