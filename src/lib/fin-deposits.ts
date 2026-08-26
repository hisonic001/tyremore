"use server";

/**
 * ⭐ 통장 입금 대조 — 쓰기 액션 (ERP 4단계, 2026-08-24)
 *
 *   ① 카드 정산 표시(적요 패턴 일괄) ② 계좌이체 판매와 잇기 ③ 외상 수금 등록.
 *   수금은 기존 정본 settleReceivables(선입선출·FOR UPDATE·잔액 방어)를 그대로 쓴다 —
 *   여기서 새 수금 로직을 만들지 않는다.
 *
 * 🔴 전부 사장님 전용. 질의 순차.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { CARD_SETTLE_PATTERN_SQL, payerKeyOf } from "./expense-cats";
import { monthRange } from "./ym";
import { cashUsedSql, normName } from "./recon-data";
import { planSettlement } from "./receivable-plan";
import { settleReceivables } from "./receivable";
import { restoreCashLine } from "./cash-restore";
import { depositReconData } from "./recon-data";
import { depositTaxCandidates, depositSurePicks } from "./deposit-tax";
import { confirmTaxToBank } from "./recon";

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}

/** ⭐ 이름 별명 학습 (사장님 요청 2026-08-24) — 한 번 이어준 입금자명은 다음부터 바로 알아본다 */
async function learnAlias(aliasRaw: string, partyKey: string, partyLabel: string): Promise<void> {
  const key = normName(aliasRaw);
  if (key.length < 2) return;
  try {
    await db.execute(sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES (${key}, ${aliasRaw}, ${partyKey}, ${partyLabel})
      ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
        party_label = EXCLUDED.party_label, updated_at = now()
    `);
  } catch {
    // 학습 실패는 본 동작을 막지 않는다
  }
}

const payerOf = (description: string): string => payerKeyOf("통장", description); // 감사 L2: 정본

/* 🔴 2026 감사 G1(2026-08-26): 입금 줄은 **남은 금액**(소진량 정본 cashUsedSql 을 뺀 값)으로 다룬다.
   매출 계산서에 일부 이어진 입금(미대조 유지)이 수금·판매 잇기에 전액 다시 배분되던 이중계상 경로 차단 */
async function getDeposit(id: number) {
  const [d] = await db.execute<{
    id: number; in_amount: number; remain: number; recon_status: string; date: string; l: string; description: string;
  }>(sql`
    SELECT c.id, c.in_amount, (c.in_amount - ${cashUsedSql("c")})::bigint remain, c.recon_status,
           to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           c.account_label l, c.description
    FROM cash_txn c WHERE c.id = ${id} AND c.source = '통장' AND c.is_active AND c.in_amount > 0
  `);
  return d ? { ...d, in_amount: Number(d.in_amount), remain: Number(d.remain) } : null;
}

/** 이 달의 카드 정산 패턴 입금(FB자금·매출표)을 한꺼번에 「카드 정산」으로 표시 */
export async function markCardSettlements(
  ym: string,
): Promise<{ ok: true; marked: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 올바르지 않습니다" };
  const { start, nextStart } = monthRange(ym); // 감사 L3
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn SET recon_status = '확정', category = '카드정산'
    WHERE source = '통장' AND is_active AND in_amount > 0 AND recon_status = '미대조'
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    RETURNING id
  `);
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  return { ok: true, marked: rows.length };
}

/** 입금 한 건을 계좌이체 판매 한 건과 잇는다 (기록만 — 판매·수금은 안 건드린다) */
export async function linkDepositToQuote(
  cashTxnId: number,
  quoteId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.recon_status === "확정") return { ok: false, error: "이미 정리된 입금입니다" };
  if (dep.remain <= 0) return { ok: false, error: "이 입금은 남은 금액이 없습니다 — 계산서 확인이 이미 썼습니다" };
  const [q] = await db.execute<{ id: number; total: number }>(sql`
    SELECT id, total_amount total FROM quote WHERE id = ${quoteId} AND status = '성사'
  `);
  if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
  const linkAmt = Math.min(dep.remain, Number(q.total)); // 남은 금액 안에서만
  const dupe = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE kind = '이체입금' AND ref_table = 'quote' AND ref_id = ${quoteId} LIMIT 1
  `);
  if (dupe.length > 0) return { ok: false, error: "그 판매는 이미 다른 입금과 이어져 있습니다" };

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('이체입금', 'cash_txn', ${cashTxnId}, 'quote', ${quoteId}, ${linkAmt}, '확정', '수동', ${g.uid}, now())
    `);
    await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
  });

  // 별명 학습 — 이 입금자명이 누구였는지 기억한다
  const [qp] = await db.execute<{ supplier_name: string | null; customer_id: number | null; cname: string | null }>(sql`
    SELECT q.supplier_name, q.customer_id, c.name cname
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id WHERE q.id = ${quoteId}
  `);
  const payer = payerOf(dep.description);
  if (qp?.supplier_name) await learnAlias(payer, `S:${qp.supplier_name}`, `거래처 ${qp.supplier_name}`);
  else if (qp?.customer_id) await learnAlias(payer, `C:${qp.customer_id}`, qp.cname ?? `고객 ${qp.customer_id}`);

  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * 입금 한 건으로 외상 대상의 미납 건들을 턴다 — 선입선출.
 * 수금 기록은 settleReceivables 정본이 만들고, 여기서는 연결(recon_match)만 얹는다.
 */
export async function collectFromDeposit(
  cashTxnId: number,
  partyKey: string,
): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.recon_status === "확정") return { ok: false, error: "이미 정리된 입금입니다" };
  if (dep.remain <= 0) return { ok: false, error: "이 입금은 남은 금액이 없습니다 — 계산서 확인이 이미 썼습니다" };

  // 대상 조건 — receivable-book 의 KEY 와 글자 그대로 같은 규칙
  let cond;
  if (partyKey.startsWith("S:")) cond = sql`q.supplier_name = ${partyKey.slice(2)}`;
  else if (partyKey.startsWith("C:")) cond = sql`q.supplier_name IS NULL AND q.customer_id = ${Number(partyKey.slice(2))}`;
  else return { ok: false, error: "대상이 올바르지 않습니다 (비회원 외상은 정비 내역에서 건별로)" };

  const rows = await db.execute<{ id: number; quote_no: string; total: number; paid: number }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total,
           COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid
    FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '외상' AND ${cond}
      AND q.total_amount > COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0)
    ORDER BY COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) ASC, q.id ASC LIMIT 100
  `);
  if (rows.length === 0) return { ok: false, error: "그 대상의 미납 외상이 없습니다" };

  const plan = planSettlement(
    rows.map((r) => ({ quoteId: Number(r.id), quoteNo: r.quote_no, remain: Number(r.total) - Number(r.paid) })),
    dep.remain, // 남은 금액만 배분 (G1)
  );
  if (plan.plan.length === 0) return { ok: false, error: "배분할 금액이 없습니다" };

  /* 🔴 감사 H5(2026-08-25): 입금이 외상 잔액보다 크면(합산·선입금) settleReceivables 가
     잔액 초과로 거부했다 — 배분된 만큼만 넘긴다. 남는 돈은 leftover 로 안내 */
  const planned = plan.plan.reduce((s, p) => s + p.amount, 0);
  const r = await settleReceivables({
    quoteIds: plan.plan.map((p) => p.quoteId),
    method: "계좌이체",
    paidOn: dep.date,
    received: Math.min(dep.remain, planned),
    memo: `통장 입금 대조 (${dep.l} ${dep.date})`,
  });
  if (!r.ok) return r;

  /* 연결 자국 — 어느 입금이 어느 판매를 털었는지. 🔴 2026 감사 G5: 자국+확정을 한 트랜잭션으로
     (settleReceivables 는 자기 트랜잭션이라 여기 못 넣는다 — 수금은 남고 자국만 없는 사고를
     되돌리기(undoDepositLink)가 memo 로 찾아 지운다) */
  await db.transaction(async (tx) => {
    for (const p of plan.plan) {
      await tx.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
        VALUES ('이체입금', 'cash_txn', ${cashTxnId}, 'quote', ${p.quoteId}, ${p.amount}, '확정', '수동', ${g.uid}, now())
      `);
    }
    await tx.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${cashTxnId}`);
  });

  // 별명 학습 — 다음부터 이 입금자명이 오면 이 외상 대상을 맨 위에 보여준다
  {
    const payer = payerOf(dep.description);
    let label = partyKey;
    if (partyKey.startsWith("S:")) label = `거래처 ${partyKey.slice(2)}`;
    else {
      const [c] = await db.execute<{ name: string }>(sql`
        SELECT name FROM customer WHERE id = ${Number(partyKey.slice(2))}
      `);
      label = c?.name ?? partyKey;
    }
    await learnAlias(payer, partyKey, label);
  }

  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  revalidatePath("/receivables");
  revalidatePath("/sales");
  return { ok: true, applied: r.applied, settled: r.settled, leftover: plan.leftover };
}

/**
 * ⭐ 입금 연결 되돌리기 (2026 감사 G3, 2026-08-26) — 판매 잇기·외상 수금으로 이은 입금을 원상복구.
 *   자국(recon_match 이체입금) 삭제 → 그 자국이 만든 수금 기록(memo '통장 입금 대조 …'·같은 날·같은
 *   금액)만 삭제(손으로 넣은 수금은 안 건드림) → 통장 줄 상태 복원(줄 단위 정본).
 */
export async function undoDepositLink(
  cashTxnId: number,
): Promise<{ ok: true; removed: number; payments: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  const marks = await db.execute<{ id: number; ref_table: string; ref_id: number; amount: number }>(sql`
    SELECT id, ref_table, ref_id, amount FROM recon_match
    WHERE kind = '이체입금' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} AND status = '확정'
    ORDER BY id LIMIT 100
  `);
  if (marks.length === 0) return { ok: false, error: "이 입금에 이어진 판매·수금이 없습니다" };
  let payments = 0;
  await db.transaction(async (tx) => {
    for (const m of marks) {
      if (m.ref_table === "quote") {
        const del = await tx.execute<{ id: number }>(sql`
          DELETE FROM receivable_payment WHERE id IN (
            SELECT id FROM receivable_payment
            WHERE quote_id = ${m.ref_id} AND method = '계좌이체' AND amount = ${m.amount}
              AND paid_on = ${dep.date}::date AND memo LIKE '통장 입금 대조%'
            ORDER BY id DESC LIMIT 1)
          RETURNING id
        `);
        payments += del.length;
      }
      await tx.execute(sql`DELETE FROM recon_match WHERE id = ${m.id}`);
    }
    await restoreCashLine(tx, cashTxnId);
  });
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  revalidatePath("/receivables");
  revalidatePath("/sales");
  return { ok: true, removed: marks.length, payments };
}

/** 판매와 무관한 입금 분류 — 이자·지원금·환불·기타 (사장님 요청 2026-08-26: 「무시」로 매출 입금을 접지 않게) */
export const DEPOSIT_KINDS = ["이자·지원금", "환불", "기타입금"] as const;

export async function setDepositKind(
  cashTxnId: number,
  kind: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(DEPOSIT_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "분류가 올바르지 않습니다" };
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.remain < dep.in_amount) return { ok: false, error: "이미 계산서·판매에 일부 이어진 입금입니다 — 먼저 되돌려 주세요" };
  await db.execute(sql`
    UPDATE cash_txn SET category = ${kind}, recon_status = '확정' WHERE id = ${cashTxnId} AND source = '통장'
  `);
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  return { ok: true };
}

export async function undoDepositKind(cashTxnId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn SET category = NULL, recon_status = '미대조'
    WHERE id = ${cashTxnId} AND category IN ('이자·지원금', '환불', '기타입금') RETURNING id
  `);
  if (rows.length === 0) return { ok: false, error: "판매와 무관으로 분류한 줄이 아닙니다" };
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * ⭐ 짝이 확실한 입금 모두 잇기 (사장님 요청 2026-08-26) — 정확 일치 + 아는 상대 하나뿐인 계산서,
 *    또는 이름 맞는 판매 하나뿐인 것. 서버가 같은 규칙으로 다시 계산한다(화면 목록을 믿지 않음).
 */
export async function confirmSureDeposits(
  ym: string,
): Promise<{ ok: true; tax: number; quote: number; failed: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 올바르지 않습니다" };
  const data = await depositReconData(ym);
  const cands = await depositTaxCandidates(
    ym,
    data.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sure = depositSurePicks(data.open, cands);
  let tax = 0;
  let quote = 0;
  let failed = 0;
  for (const [cashId, pick] of sure) {
    const r = pick.kind === "tax" ? await confirmTaxToBank(pick.invId, cashId) : await linkDepositToQuote(cashId, pick.quoteId);
    if (!r.ok) failed++;
    else if (pick.kind === "tax") tax++;
    else quote++;
  }
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  return { ok: true, tax, quote, failed };
}

/** 무시 / 무시 해제 */
export async function ignoreDeposit(
  cashTxnId: number,
  back = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  await db.execute(sql`
    UPDATE cash_txn SET recon_status = ${back ? "미대조" : "무시"}
    WHERE id = ${cashTxnId} AND source = '통장' AND recon_status <> '확정'
  `);
  revalidatePath("/finance/deposits");
  return { ok: true };
}

/** 🔴 감사 H10(2026-08-25): 카드정산 표시 취소 — 우연히 패턴에 걸린 진짜 입금을 되살린다 */
export async function unmarkCardSettlement(
  cashTxnId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE cash_txn SET category = NULL, recon_status = '미대조'
    WHERE id = ${cashTxnId} AND category = '카드정산' RETURNING id
  `);
  if (rows.length === 0) return { ok: false, error: "카드정산으로 표시된 줄이 아닙니다" };
  revalidatePath("/finance/deposits");
  revalidatePath("/finance");
  return { ok: true };
}
