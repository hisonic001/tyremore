/**
 * ⭐ 미지급 리모델링 — 거래처 한 장에 세 장부를 합치는 조회 정본 (사장님 승인 2026-08-31)
 *
 *   "앱상에서도 편하게 사용자 중심으로 쉽게 알아보고 쉽게 처리할수 있어야 …
 *    미지급 부분이 전반적으로 remodeling 되었으면 좋겠는데"
 *
 *   그날 사장님이 물으신 것들의 공통 원인: 돈의 진실이 세 장부(앱 매입 장부 ·
 *   세금계산서 · 통장/카드)에 흩어져 있는데 화면은 하나씩만 보여줬다.
 *   여기서 거래처마다 세 장부를 **한 장으로 합쳐** 내려보낸다:
 *
 *     · 이번 달 준 돈 — 통장(매입대금 분류)·법인카드에서 별명으로 귀속
 *     · 이번 달 매입 세금계산서 — 사업자번호·이름 맞추기로 귀속, 확정 여부까지
 *     · 원단위 자동 잇기 제안 — 출금이 인보이스(또는 같은 날 묶음)와 정확히 일치
 *       (2026-08-31 실측: 콘티 4건·미쉐린 4건이 이 규칙으로 정확히 맞았다)
 *     · 예치금 — 출금을 일부만 이은 뒤 남은 돈 (딜러타이어 충전식)
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 순차 · LIMIT.
 *    이름 귀속은 payLinkData 와 같은 정본(normName·samePartyName·party_alias)을 쓴다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange } from "./ym";
import { cashUsedSql, normName, samePartyName } from "./recon-data";
import { payerKeyOf } from "./expense-cats";
import { exactPlan } from "./payables-plan";

export { exactPlan } from "./payables-plan";


export interface ExactSuggest {
  cashTxnId: number;
  day: string;
  amount: number;
  invoiceNos: string[];
}

export interface SupplierCardInfo {
  /** 이번 달 준 돈 — 통장(매입대금)·법인카드, 접힌 것 포함 (나간 돈은 나간 돈이다) */
  bankN: number;
  bankSum: number;
  cardN: number;
  cardSum: number;
  /** 이번 달 매입 세금계산서 */
  taxN: number;
  taxSum: number;
  taxOkN: number;
  /** 🔴 「출금연결」 확정 계산서 합만 — 월정산·차액 확정은 돈이 나간 증거가 아니다
      (강남세차장 14,322,000 이 월정산-확정이라 도장이 잘못 떴던 사고, 2026-08-31) */
  taxOkSum: number;
  /** 출금을 일부만 잇고 남은 돈 (예치금 — 전 기간) */
  deposit: number;
  /** 원단위 자동 잇기 제안 */
  exact: ExactSuggest[];
  /** 통장 이름 별명들 */
  aliases: { key: string; raw: string }[];
}

export const emptyCardInfo = (): SupplierCardInfo => ({
  bankN: 0, bankSum: 0, cardN: 0, cardSum: 0,
  taxN: 0, taxSum: 0, taxOkN: 0, taxOkSum: 0,
  deposit: 0, exact: [], aliases: [],
});

/**
 * 거래처별 카드 정보. `suppliers` 는 미지급 잔액이 있는 거래처 이름들 —
 * 예치금만 남은 거래처(잔액 0)도 카드가 나오도록 결과에는 그 밖 이름도 담길 수 있다.
 */
export async function payablesCardInfo(
  ym: string,
  suppliers: string[],
): Promise<Record<string, SupplierCardInfo>> {
  const { start, nextStart } = monthRange(ym);
  const out: Record<string, SupplierCardInfo> = {};
  const at = (sup: string) => (out[sup] ??= emptyCardInfo());

  /* ── 이름 → 거래처 해석 재료 (payLinkData 와 같은 정본) ── */
  const sAliases = await db.execute<{ alias_key: string; alias_raw: string; party_key: string }>(sql`
    SELECT alias_key, alias_raw, party_key FROM party_alias WHERE party_key LIKE 'S:%'
  `);
  const tAliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias WHERE party_key LIKE 'T:%'
  `);
  const supBiz = await db.execute<{ name: string; biz_no: string }>(sql`
    SELECT name, biz_no FROM supplier WHERE biz_no IS NOT NULL AND is_active LIMIT 500
  `);
  const bizToSup = new Map(supBiz.map((r) => [r.biz_no.replace(/\D/g, ""), r.name]));
  const aliasMap = new Map(sAliases.map((a) => [a.alias_key, a.party_key.slice(2)]));
  const tMap = new Map<string, string>();
  for (const a of tAliases) {
    const nm = a.alias_key.split("@")[0];
    const sup = bizToSup.get(a.party_key.slice(2));
    if (nm && sup) tMap.set(nm, sup);
  }
  const allSup = [...new Set([...suppliers, ...sAliases.map((a) => a.party_key.slice(2))])];
  const resolve = (payer: string): string | null => {
    const pn = normName(payer);
    return aliasMap.get(pn) ?? tMap.get(pn) ?? allSup.find((n) => samePartyName(n, payer)) ?? null;
  };
  for (const a of sAliases) {
    const sup = a.party_key.slice(2);
    if (suppliers.includes(sup)) at(sup).aliases.push({ key: a.alias_key, raw: a.alias_raw });
  }

  /* ── 이번 달 준 돈 — 통장 매입대금 (접힌 것 포함) ── */
  const bank = await db.execute<{ id: number; d: string; description: string; out: number; remain: string; linked: number }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, c.description, c.out_amount out,
           (c.out_amount - ${cashUsedSql("c")})::bigint remain,
           (SELECT count(*)::int FROM recon_match m
             WHERE m.kind = '매입지급' AND m.src_table = 'cash_txn' AND m.src_id = c.id AND m.status = '확정') linked
    FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active AND c.category = '매입대금' AND c.out_amount > 0
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    ORDER BY c.occurred_at LIMIT 200
  `);
  /** 자동 잇기 후보 — 남은 돈>0 이고 아직 안 이어진 줄로만 만든다 (접힌 줄도 준 돈 합계에는 든다) */
  type BankRow = { id: number; d: string; description: string; out: number; remain: string; linked: number };
  const bankBySup = new Map<string, BankRow[]>();
  for (const b of bank) {
    const sup = resolve(payerKeyOf("통장", b.description));
    if (!sup) continue;
    const info = at(sup);
    info.bankN++;
    info.bankSum += Number(b.out);
    if (Number(b.linked) > 0 && Number(b.remain) > 0) info.deposit += Number(b.remain);
    bankBySup.set(sup, [...(bankBySup.get(sup) ?? []), b]);
  }

  /* ── 이번 달 준 돈 — 법인카드 ── */
  const card = await db.execute<{ description: string; out: string; n: number }>(sql`
    SELECT c.description, SUM(c.out_amount)::bigint out, count(*)::int n
    FROM cash_txn c
    WHERE c.source = '법인카드' AND c.is_active AND c.out_amount > 0
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    GROUP BY 1 LIMIT 300
  `);
  for (const cr of card) {
    const sup = resolve(cr.description.trim());
    if (!sup || !suppliers.includes(sup)) continue;
    at(sup).cardN += Number(cr.n);
    at(sup).cardSum += Number(cr.out);
  }

  /* ── 이번 달 매입 세금계산서 — 사업자번호 우선, 이름 맞추기 보조 ── */
  const tax = await db.execute<{ biz: string | null; name: string; total: number; st: string; reason: string }>(sql`
    SELECT counterparty_biz_no biz, counterparty_name name, total, recon_status st,
           COALESCE(recon_reason, '') reason
    FROM tax_invoice
    WHERE is_active AND direction = '매입'
      AND write_date >= ${start}::date AND write_date < ${nextStart}::date
    ORDER BY write_date LIMIT 300
  `);
  for (const t of tax) {
    const biz = (t.biz ?? "").replace(/\D/g, "");
    let sup = biz ? bizToSup.get(biz) ?? null : null;
    if (!sup) sup = tMap.get(normName(t.name)) ?? null;
    if (!sup) sup = suppliers.find((n) => samePartyName(n, t.name)) ?? null;
    if (!sup || !suppliers.includes(sup)) continue;
    const info = at(sup);
    info.taxN++;
    info.taxSum += Number(t.total);
    if (t.st === "확정" && t.reason === "출금연결") {
      info.taxOkN++;
      info.taxOkSum += Number(t.total);
    }
  }

  /* ── 원단위 자동 잇기 제안 ── */
  for (const sup of suppliers) {
    const rows = bankBySup.get(sup) ?? [];
    const cand = rows.filter((b) => Number(b.remain) > 0 && Number(b.linked) === 0);
    if (cand.length === 0) continue;
    const invs = await db.execute<{ id: number; no: string; d: string | null; remain: string }>(sql`
      SELECT pi.id, pi.invoice_no no, pi.issued_at d,
             (pi.total - COALESCE((SELECT SUM(amount) FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0))::bigint remain
      FROM purchase_invoice pi
      WHERE pi.status <> '취소' AND pi.supplier = ${sup} AND pi.total > 0
      ORDER BY pi.issued_at LIMIT 100
    `);
    const open = invs.map((i) => ({ id: Number(i.id), no: i.no, d: i.d, remain: Number(i.remain) }));
    for (const b of cand) {
      const plan = exactPlan(Number(b.remain), open);
      if (!plan) continue;
      at(sup).exact.push({ cashTxnId: Number(b.id), day: b.d, amount: Number(b.remain), invoiceNos: plan.nos });
      // 같은 인보이스를 두 출금에 제안하지 않는다
      for (const id of plan.ids) {
        const o = open.find((x) => x.id === id);
        if (o) o.remain = 0;
      }
    }
  }

  return out;
}

/** 별명 추가할 때 고를 통장 이름 후보 — 이 달 통장 출금 상대 (2026-08-31 "검색으로 찾기") */
export async function bankPayerOptions(ym: string): Promise<string[]> {
  const { start, nextStart } = monthRange(ym);
  const rows = await db.execute<{ description: string }>(sql`
    SELECT DISTINCT description FROM cash_txn
    WHERE source = '통장' AND is_active AND out_amount > 0
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    LIMIT 200
  `);
  return [...new Set(rows.map((r) => payerKeyOf("통장", r.description)).filter((x) => x.length >= 2))].sort();
}
