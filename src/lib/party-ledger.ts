/**
 * ⭐ 거래처 원장 (ERP 구조화 배치3, 사장님 승인 2026-08-25)
 *
 *   한 상대의 세금계산서·통장 입출금·앱 매입/판매·지급/수금을 시간순 한 표로.
 *   key 는 partyKey 규약 그대로 — 'S:거래처이름' · 'C:고객id' · 'B:사업자번호'(거래처
 *   미등록 상대 폴백). party_alias·receivable-book 과 같은 열쇠라 세 자료가 이어진다.
 *
 *   통장 줄은 이름(별명 사전에 배운 이름 포함)으로 찾는다 — 한 번 이어 배운 상대는
 *   (주식회사 위즈↔위즈오토) 여기서도 자동으로 잡힌다.
 *
 * 🔴 "use server" 아님 — 페이지가 권한 확인 후 부른다. 질의 순차 · LIMIT.
 * 🔴 러닝 밸런스 열 없음 — 원천이 이질적이라 복식부기 흉내가 된다 (설계 결정).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { partyMatchSql, partyMonthlyCash, partyStrictNames } from "./recon-data";
import { monthRange } from "./ym";

export interface LedgerRow {
  /** YYYY-MM-DD */
  d: string;
  kind: "계산서" | "입금" | "출금" | "매입" | "판매" | "지급" | "수금";
  label: string;
  /** +받는 축(판매·수금·입금·매출계산서) / −주는 축(매입·지급·출금·매입계산서) */
  amount: number;
  status: string | null;
}

/** 달별 계산서·지급 요약 — 월합계 계산서를 쓰는 상대의 채무 장부 (2026-08-25) */
export interface PartyMonthRow {
  ym: string;
  invSum: number;
  paySum: number;
  /** 그 달까지의 누적 미지급 */
  running: number;
}

export interface PartyLedger {
  key: string;
  title: string;
  /** 이 상대를 찾는 데 쓴 이름들 (본이름 + 배운 별명) */
  names: string[];
  rows: LedgerRow[];
  /** 줄 돈 — 앱 매입 잔액 (전체 기간, S만) */
  payableRemain: number;
  /** 받을 돈 — 외상 잔액 (전체 기간) */
  receivableRemain: number;
  /** 출금 확인 안 된 매입 세금계산서 합 (보는 달까지 누적) */
  taxOpenSum: number;
  /** 달별 계산서 vs 지급 — 오래된 달부터, 누적 잔액 포함 */
  months: PartyMonthRow[];
}

/** key 해석 실패(모르는 접두어·없는 상대)면 null */
export async function partyLedgerData(key: string, ym: string): Promise<PartyLedger | null> {
  const { start, nextStart } = monthRange(ym);

  // ── ① 상대 해석 (순차) ──
  let title = "";
  let supplierName: string | null = null;
  let customerId: number | null = null;
  const bizNos: string[] = [];
  const names: string[] = [];

  if (key.startsWith("S:")) {
    supplierName = key.slice(2);
    title = supplierName;
    names.push(supplierName);
    // supplier.biz_no 는 add-tax-invoice.ts 가 추가한 raw 컬럼 — 스키마 밖이라 raw 로
    const sup = await db.execute<{ biz_no: string | null }>(sql`
      SELECT biz_no FROM supplier WHERE name = ${supplierName} LIMIT 1
    `);
    if (sup[0]?.biz_no) bizNos.push(sup[0].biz_no);
  } else if (key.startsWith("C:")) {
    customerId = Number(key.slice(2));
    if (!Number.isFinite(customerId)) return null;
    const cus = await db.execute<{ name: string }>(sql`
      SELECT name FROM customer WHERE id = ${customerId} LIMIT 1
    `);
    if (!cus[0]) return null;
    title = cus[0].name;
    names.push(cus[0].name);
  } else if (key.startsWith("B:")) {
    const biz = key.slice(2).replace(/\D/g, "");
    if (!biz) return null;
    bizNos.push(biz);
    const t = await db.execute<{ name: string }>(sql`
      SELECT counterparty_name name FROM tax_invoice
      WHERE is_active AND counterparty_biz_no = ${biz} ORDER BY id DESC LIMIT 1
    `);
    if (!t[0]) return null;
    title = t[0].name;
    names.push(t[0].name);
    /* 🔴 수리(2026-08-25): 사업자번호로 앱 거래처를 찾아 매입·지급·판매까지 잇는다.
       (전에는 B: 키면 계산서·통장만 보여 원장이 반쪽이었다) */
    const sup2 = await db.execute<{ name: string }>(sql`
      SELECT name FROM supplier WHERE biz_no = ${biz} LIMIT 1
    `);
    if (sup2[0]) {
      supplierName = sup2[0].name;
      if (!names.includes(sup2[0].name)) names.push(sup2[0].name);
    }
  } else {
    return null;
  }

  /* 배운 별명들 → 통장·계산서 이름 매칭에 합류.
     🔴 수리(2026-08-25): 은행 적요는 12자쯤에서 잘린다(「미쉐린코리아(」) — 상호명으로는
     ILIKE 가 안 걸린다. 지급출금 별명('T:사업자번호')·거래처 별명('S:이름')까지 끌어와야
     통장 줄이 잡힌다. 이걸 안 해서 원장의 지급이 0원으로 보였다. */
  const keyList = [key, ...bizNos.map((b) => `T:${b}`)];
  if (supplierName) keyList.push(`S:${supplierName}`);
  const aliases = await db.execute<{ raw: string }>(sql`
    SELECT alias_raw raw FROM party_alias
    WHERE party_key IN (${sql.join(keyList.map((k) => sql`${k}`), sql`, `)})
    ORDER BY id DESC LIMIT 20
  `);
  for (const a of aliases) if (!names.includes(a.raw)) names.push(a.raw);

  const rows: LedgerRow[] = [];
  /* 이름 맞추기는 정본(partyMatchSql) — 적요 잘림·㈜ 표기 차이를 견딘다 (2026-08-25) */
  const nameConds = partyMatchSql(names.slice(0, 15));

  // ── ② 세금계산서 (이 달) ──
  const taxCond =
    bizNos.length > 0
      ? sql`(counterparty_biz_no IN (${sql.join(bizNos.map((b) => sql`${b}`), sql`, `)})
             OR counterparty_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)}))`
      : sql`counterparty_name IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`;
  const taxes = await db.execute<{
    d: string; direction: string; total: number; item: string | null; st: string;
  }>(sql`
    SELECT to_char(write_date, 'YYYY-MM-DD') d, direction, total, item_summary item, recon_status st
    FROM tax_invoice
    WHERE is_active AND ${taxCond}
      AND write_date >= ${start}::date AND write_date < ${nextStart}::date
    ORDER BY write_date LIMIT 200
  `);
  for (const t of taxes) {
    rows.push({
      d: t.d,
      kind: "계산서",
      label: `세금계산서 ${t.direction}${t.item ? ` · ${t.item}` : ""}`,
      amount: t.direction === "매출" ? Number(t.total) : -Number(t.total),
      status: t.st,
    });
  }

  // ── ③ 통장 입출금 (이 달, 이름 매칭 — 별명 포함) ──
  const cash = await db.execute<{
    d: string; description: string; in_amount: number; out_amount: number; st: string;
  }>(sql`
    SELECT to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
           description, in_amount, out_amount, recon_status st
    FROM cash_txn
    WHERE source = '통장' AND is_active AND (${nameConds})
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    ORDER BY occurred_at LIMIT 200
  `);
  for (const c of cash) {
    const isIn = Number(c.in_amount) > 0;
    rows.push({
      d: c.d,
      kind: isIn ? "입금" : "출금",
      label: c.description,
      amount: isIn ? Number(c.in_amount) : -Number(c.out_amount),
      status: c.st,
    });
  }

  // ── ④ 앱 매입 + 지급 (거래처만, 이 달) ──
  if (supplierName) {
    const buys = await db.execute<{ d: string | null; no: string; total: number | null }>(sql`
      SELECT COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d,
             invoice_no no, total
      FROM purchase_invoice
      WHERE supplier = ${supplierName} AND status <> '취소'
        AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) >= ${start}
        AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) < ${nextStart}
      ORDER BY 1 LIMIT 200
    `);
    for (const b of buys) {
      rows.push({ d: b.d ?? start, kind: "매입", label: `매입 ${b.no}`, amount: -Number(b.total ?? 0), status: null });
    }
    const pays = await db.execute<{ d: string; amount: number; method: string; no: string }>(sql`
      SELECT to_char(pp.paid_on, 'YYYY-MM-DD') d, pp.amount, pp.method, pi.invoice_no no
      FROM purchase_payment pp JOIN purchase_invoice pi ON pi.id = pp.invoice_id
      WHERE pi.supplier = ${supplierName}
        AND pp.paid_on >= ${start}::date AND pp.paid_on < ${nextStart}::date
      ORDER BY pp.paid_on LIMIT 200
    `);
    for (const p of pays) {
      rows.push({ d: p.d, kind: "지급", label: `지급 (${p.method}) · ${p.no}`, amount: -Number(p.amount), status: null });
    }
  }

  // ── ⑤ 앱 판매 + 외상 수금 (이 달) ──
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const partyQuote = supplierName
    ? sql`q.supplier_name = ${supplierName}`
    : customerId !== null
      ? sql`q.customer_id = ${customerId}`
      : null;
  if (partyQuote) {
    const sales = await db.execute<{ d: string; no: string; total: number; pm: string | null }>(sql`
      SELECT to_char(${D}, 'YYYY-MM-DD') d, q.quote_no no, q.total_amount total, q.payment_method pm
      FROM quote q
      WHERE q.status = '성사' AND q.quote_no LIKE 'Q%' AND ${partyQuote}
        AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
      ORDER BY 1 LIMIT 200
    `);
    for (const s of sales) {
      rows.push({ d: s.d, kind: "판매", label: `판매 ${s.no}${s.pm ? ` (${s.pm})` : ""}`, amount: Number(s.total), status: null });
    }
    const colls = await db.execute<{ d: string; amount: number; method: string; no: string }>(sql`
      SELECT to_char(rp.paid_on, 'YYYY-MM-DD') d, rp.amount, rp.method, q.quote_no no
      FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id
      WHERE ${partyQuote}
        AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
      ORDER BY rp.paid_on LIMIT 200
    `);
    for (const c of colls) {
      rows.push({ d: c.d, kind: "수금", label: `외상 수금 (${c.method}) · ${c.no}`, amount: Number(c.amount), status: null });
    }
  }

  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  // ── ⑥ 잔액 요약 (전체 기간 — 미지급·외상 화면과 같은 식) ──
  let payableRemain = 0;
  if (supplierName) {
    const [p] = await db.execute<{ s: string }>(sql`
      SELECT COALESCE(SUM(pi.total - COALESCE(pp.paid, 0)), 0)::bigint s
      FROM purchase_invoice pi
      LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
      WHERE pi.supplier = ${supplierName} AND pi.status <> '취소' AND pi.total IS NOT NULL
        AND pi.total > COALESCE(pp.paid, 0)
    `);
    payableRemain = Number(p.s);
  }
  let receivableRemain = 0;
  if (partyQuote) {
    const [r] = await db.execute<{ s: string }>(sql`
      SELECT COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0)), 0)::bigint s
      FROM quote q
      LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM receivable_payment x WHERE x.quote_id = q.id) rp ON true
      WHERE q.status = '성사' AND q.payment_method = '외상' AND ${partyQuote}
        AND q.total_amount > COALESCE(rp.paid, 0)
    `);
    receivableRemain = Number(r.s);
  }
  const [to] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(total), 0)::bigint s FROM tax_invoice
    WHERE is_active AND direction = '매입' AND recon_status IN ('미대조', '제안')
      AND write_date < ${nextStart}::date AND ${taxCond}
    -- 🔴 2025 감사 F12: 2026-08 이후만 세어 2025 원장에 엉뚱한 값(1,045,000)이 찍혔다 — 보는 달까지
  `);

  /* ⭐ 달별 계산서 vs 지급 (2026-08-25) — 미쉐린처럼 월말 합계 계산서를 쓰는 상대는
     개별 매칭이 불가능하므로, 「이 달 발행 − 이 달 지급 = 잔액」이 진짜 장부가 된다. */
  /* 🔴 수리(2026-08-25): 「무시」로 접어 둔 계산서도 실제로 발행돼 돈을 줘야 하는 채무다
     — 화면 정리 상태일 뿐이므로 잔액에서 빼면 안 된다 (전에는 과거분이 통째로 빠져
     계산서 0원으로 보였다). 채무 장부이므로 매입만 센다. */
  const mInv = await db.execute<{ ym: string; s: string }>(sql`
    SELECT to_char(write_date, 'YYYY-MM') ym, COALESCE(SUM(total), 0)::bigint s
    FROM tax_invoice
    WHERE is_active AND direction = '매입' AND ${taxCond}
    GROUP BY 1 ORDER BY 1 LIMIT 36
  `);
  /* 🔴 감사 B5(2026-08-25): 달별 지급 = 정본(partyStrictNames+partyMonthlyCash),
     환불·상계 입금 차감(출금−입금) — 월정산 카드와 같은 식이라 두 화면 잔액이 일치 */
  const strictNames = bizNos.length > 0 ? await partyStrictNames(bizNos[0]) : names;
  const cashByYm = await partyMonthlyCash(strictNames);
  const mPay = [...cashByYm].map(([ym2, v]) => ({ ym: ym2, s: String(v.outS - v.inS) }));
  const invMap = new Map(mInv.map((r) => [r.ym, Number(r.s)]));
  const payMap = new Map(mPay.map((r) => [r.ym, Number(r.s)]));
  const allYms = [...new Set([...invMap.keys(), ...payMap.keys()])].sort();
  let running = 0;
  const months: PartyMonthRow[] = allYms.map((m) => {
    const i = invMap.get(m) ?? 0;
    const p = payMap.get(m) ?? 0;
    running += i - p;
    return { ym: m, invSum: i, paySum: p, running };
  });

  return {
    key,
    title,
    names,
    rows,
    payableRemain,
    receivableRemain,
    taxOpenSum: Number(to.s),
    months,
  };
}

export interface PartyListRow {
  name: string;
  payableRemain: number;
  receivableRemain: number;
}

/** 거래처 목록 + 잔액 — /finance/party 첫 화면 */
export async function partyListData(): Promise<PartyListRow[]> {
  const pay = await db.execute<{ s: string; remain: string }>(sql`
    SELECT pi.supplier s, SUM(pi.total - COALESCE(pp.paid, 0))::bigint remain
    FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > COALESCE(pp.paid, 0)
    GROUP BY 1 LIMIT 100
  `);
  const recv = await db.execute<{ s: string; remain: string }>(sql`
    SELECT q.supplier_name s, SUM(q.total_amount - COALESCE(rp.paid, 0))::bigint remain
    FROM quote q
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM receivable_payment x WHERE x.quote_id = q.id) rp ON true
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.supplier_name IS NOT NULL
      AND q.total_amount > COALESCE(rp.paid, 0)
    GROUP BY 1 LIMIT 100
  `);
  const all = await db.execute<{ name: string }>(sql`
    SELECT name FROM supplier WHERE is_active
    UNION SELECT DISTINCT supplier FROM purchase_invoice WHERE status <> '취소'
    ORDER BY 1 LIMIT 150
  `);
  const payMap = new Map(pay.map((r) => [r.s, Number(r.remain)]));
  const recvMap = new Map(recv.map((r) => [r.s, Number(r.remain)]));
  return all.map((r) => ({
    name: r.name,
    payableRemain: payMap.get(r.name) ?? 0,
    receivableRemain: recvMap.get(r.name) ?? 0,
  }));
}
