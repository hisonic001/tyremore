"use server";

/**
 * ⭐ 매입 대금 지급 — 쓰기 액션 (ERP ⑦, 사장님 지시 2026-08-25)
 *
 *   외상 수금(settleReceivables)의 거울상: 거래처에 준 돈을 오래된 인보이스부터
 *   선입선출로 채운다. 잔액은 파생값 — 넘치게 못 넣는다.
 *
 * 🔴 사장님 전용. 트랜잭션 + FOR UPDATE + IN(sql.join) 관용구 (receivable.ts 계보).
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { cashUsedSql, normName } from "./recon-data";
import { planSettlement } from "./receivable-plan";
import { restoreCashLine } from "./cash-restore";

const METHODS = ["계좌이체", "현금", "카드", "기타"];

/** 거래처에 준 돈을 오래된 매입부터 채운다 */
export async function payToSupplier(input: {
  supplier: string;
  amount: number;
  method: string;
  paidOn?: string | null;
  memo?: string | null;
}): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const session = await getSession();
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "거래처를 골라 주세요" };
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: "지급 금액이 올바르지 않습니다" };
  if (!METHODS.includes(input.method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const paidOn = input.paidOn?.trim() || null;
  if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "날짜는 2026-08-25 형식입니다" };

  try {
    return await db.transaction(async (tx) => {
      // 🔴 FOR UPDATE — 같은 인보이스에 동시에 지급을 넣으면 잔액을 넘길 수 있다
      const rows = await tx.execute<{ id: number; invoice_no: string; total: number; paid: string }>(sql`
        SELECT pi.id, pi.invoice_no, pi.total,
               COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
        FROM purchase_invoice pi
        WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total IS NOT NULL AND pi.total > 0
        ORDER BY COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) ASC, pi.id ASC
        LIMIT 200
        FOR UPDATE OF pi
      `);
      const open = rows
        .map((r) => ({ quoteId: Number(r.id), quoteNo: r.invoice_no, remain: Number(r.total) - Number(r.paid) }))
        .filter((r) => r.remain > 0);
      if (open.length === 0) return { ok: false as const, error: "그 거래처의 미지급 매입이 없습니다" };

      // 선입선출 배분 — 외상 수금과 같은 규칙 (receivable-plan)
      const plan = planSettlement(open, input.amount);
      if (plan.plan.length === 0) return { ok: false as const, error: "배분할 금액이 없습니다" };

      for (const p of plan.plan) {
        await tx.execute(sql`
          INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
          VALUES (${p.quoteId}, ${p.amount}, ${input.method},
                  ${paidOn ?? sql`(now() AT TIME ZONE 'Asia/Seoul')::date`}, ${input.memo?.trim() || null},
                  ${session?.uid ?? null})
        `);
      }
      const applied = plan.plan.reduce((s, p) => s + p.amount, 0);
      const settled = plan.plan.filter((p) => p.amount === open.find((o) => o.quoteId === p.quoteId)?.remain).length;

      revalidatePath("/finance/payables");
      revalidatePath("/finance");
      return { ok: true as const, applied, settled, leftover: plan.leftover };
    });
  } catch (e) {
    return { ok: false, error: `지급을 넣지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 지급 기록 지우기 — 잘못 넣었을 때 (수금 removeCollection 의 거울상).
 *  🔴 2026 감사 G2: 「출금에서 지급 잡기」로 생긴 지급이면 짝 자국(recon_match 매입지급)도 지우고
 *     통장 줄을 복원한다 — 전에는 지급만 지워 그 출금이 영구 소진 상태로 남았다 */
export async function removePurchasePayment(
  paymentId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const [pp] = await db.execute<{ id: number; invoice_id: number; amount: number; memo: string | null }>(sql`
    SELECT id, invoice_id, amount, memo FROM purchase_payment WHERE id = ${paymentId}
  `);
  if (!pp) return { ok: false, error: "지급 기록을 찾을 수 없습니다" };
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM purchase_payment WHERE id = ${paymentId}`);
    if (pp.memo && pp.memo.startsWith("통장 출금 연결")) {
      const gone = await tx.execute<{ src_id: number }>(sql`
        DELETE FROM recon_match WHERE id IN (
          SELECT id FROM recon_match
          WHERE kind = '매입지급' AND ref_table = 'purchase_invoice' AND ref_id = ${pp.invoice_id}
            AND amount = ${pp.amount} AND status = '확정'
          ORDER BY id DESC LIMIT 1)
        RETURNING src_id
      `);
      for (const gRow of gone) await restoreCashLine(tx, Number(gRow.src_id));
    }
  });
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  revalidatePath("/finance/expenses");
  return { ok: true };
}

/**
 * ⭐ 「출금에서 지급 잡기」 되돌리기 (2026 감사 G2, 2026-08-26) — 출금 한 줄의 지급 전체를 원상복구.
 *   자국(매입지급) 삭제 → 그 자국이 만든 지급 기록(memo '통장 출금 연결 …'·같은 금액)만 삭제 →
 *   통장 줄 상태·'매입대금' 분류 복원(줄 단위 정본 restoreCashLine).
 */
export async function undoPayFromWithdrawal(
  cashTxnId: number,
): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const marks = await db.execute<{ id: number; ref_id: number; amount: number }>(sql`
    SELECT id, ref_id, amount FROM recon_match
    WHERE kind = '매입지급' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} AND status = '확정'
    ORDER BY id LIMIT 100
  `);
  if (marks.length === 0) return { ok: false, error: "이 출금에 이어진 지급이 없습니다" };
  await db.transaction(async (tx) => {
    for (const m of marks) {
      await tx.execute(sql`
        DELETE FROM purchase_payment WHERE id IN (
          SELECT id FROM purchase_payment
          WHERE invoice_id = ${m.ref_id} AND amount = ${m.amount} AND memo LIKE '통장 출금 연결%'
          ORDER BY id DESC LIMIT 1)
      `);
      await tx.execute(sql`DELETE FROM recon_match WHERE id = ${m.id}`);
    }
    await restoreCashLine(tx, cashTxnId);
  });
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  revalidatePath("/finance/tax");
  revalidatePath("/finance/expenses");
  revalidatePath("/finance/party");
  return { ok: true, removed: marks.length };
}

/**
 * ⭐ 「이을 것 없음 — 접기」 (사장님 질문 2026-08-31 "존재 이유를 잘 모르겠음")
 *
 *   지급 잡기 목록의 태반이 **앱 이전 기간(7월분 이하) 대금**이라 이을 인보이스가
 *   없었다 — 그 줄들이 영영 남아 화면이 숙제처럼 보였다. 접으면 목록에서 빠지고
 *   「접어둔 출금」에서 언제든 되살린다. 분류(매입대금)·손익은 그대로다.
 */
export async function skipWithdrawal(
  cashTxnId: number,
  restore = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const [c] = await db.execute<{ id: number; st: string }>(sql`
    SELECT id, recon_status st FROM cash_txn
    WHERE id = ${cashTxnId} AND source = '통장' AND is_active AND out_amount > 0 AND category = '매입대금'
  `);
  if (!c) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  if (!restore) {
    if (c.st === "무시") return { ok: false, error: "이미 접힌 출금입니다" };
    const linked = await db.execute<{ id: number }>(sql`
      SELECT id FROM recon_match WHERE kind = '매입지급' AND src_table = 'cash_txn' AND src_id = ${cashTxnId} LIMIT 1
    `);
    if (linked.length > 0) return { ok: false, error: "이미 지급으로 이어진 출금입니다 — 먼저 되돌려 주세요" };
    await db.execute(sql`
      UPDATE cash_txn SET recon_status = '무시',
        memo = COALESCE(memo || ' · ', '') || '지급 잡기에서 접음 (이을 인보이스 없음)'
      WHERE id = ${cashTxnId}
    `);
  } else {
    if (c.st !== "무시") return { ok: false, error: "접힌 출금이 아닙니다" };
    await db.execute(sql`UPDATE cash_txn SET recon_status = '미대조' WHERE id = ${cashTxnId}`);
  }
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  return { ok: true };
}

/**
 * 🔴 감사 P2(2026-08-25): 「출금에서 지급 잡기」 — '매입대금' 통장 출금 한 건으로
 *   거래처 미지급을 선입선출로 턴다. 지급 기록 + 연결 자국('매입지급') + 출금 확정 + 별명 학습.
 *   미지급 장부가 "이미 준 돈"을 알게 되는 핵심 고리.
 */
export async function payFromWithdrawal(input: {
  cashTxnId: number;
  supplier: string;
}): Promise<
  | { ok: true; applied: number; settled: number; leftover: number }
  | { ok: false; error: string }
> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const session = await getSession();
  const supplier = input.supplier?.trim();
  if (!supplier) return { ok: false, error: "거래처를 골라 주세요" };

  const [dep] = await db.execute<{
    id: number; out_amount: number; recon_status: string; date: string; l: string; description: string;
  }>(sql`
    SELECT id, out_amount, recon_status,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           account_label l, description
    FROM cash_txn WHERE id = ${input.cashTxnId} AND source = '통장' AND is_active AND out_amount > 0
  `);
  if (!dep) return { ok: false, error: "출금 줄을 찾을 수 없습니다" };
  const dupe = await db.execute<{ id: number }>(sql`
    SELECT id FROM recon_match WHERE src_table = 'cash_txn' AND src_id = ${input.cashTxnId}
      AND kind = '매입지급' LIMIT 1
  `);
  if (dupe.length > 0) return { ok: false, error: "이미 지급으로 이어진 출금입니다" };
  /* 🔴 감사 B4(2026-08-25): 계산서 확인·수금이 이미 쓴 몫을 빼고 배분 — 같은 출금
     이중 소진 차단. 2026 감사 G7: 손 복제본 대신 소진량 정본 cashUsedSql */
  const [usedRow] = await db.execute<{ s: string }>(sql`
    SELECT ${cashUsedSql("c")}::bigint s FROM cash_txn c WHERE c.id = ${input.cashTxnId}
  `);
  const avail = Number(dep.out_amount) - Number(usedRow?.s ?? 0);
  if (avail <= 0)
    return { ok: false, error: "이 출금은 남은 금액이 없습니다 — 계산서 확인이 이미 썼습니다" };

  try {
    return await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number; invoice_no: string; total: number; paid: string }>(sql`
        SELECT pi.id, pi.invoice_no, pi.total,
               COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
        FROM purchase_invoice pi
        WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total IS NOT NULL AND pi.total > 0
        ORDER BY COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) ASC, pi.id ASC
        LIMIT 200
        FOR UPDATE OF pi
      `);
      const open = rows
        .map((r) => ({ quoteId: Number(r.id), quoteNo: r.invoice_no, remain: Number(r.total) - Number(r.paid) }))
        .filter((r) => r.remain > 0);
      if (open.length === 0)
        return {
          ok: false as const,
          error: `「${supplier}」는 지금 미지급이 0원입니다 — 인보이스가 아직 앱에 안 들어온 선지급이면 입고 뒤에 이어 주세요`,
        };
      const plan = planSettlement(open, avail);
      if (plan.plan.length === 0) return { ok: false as const, error: "배분할 금액이 없습니다" };

      for (const p of plan.plan) {
        await tx.execute(sql`
          INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
          VALUES (${p.quoteId}, ${p.amount}, '계좌이체', ${dep.date},
                  ${"통장 출금 연결 (" + dep.l + " " + dep.date + ")"}, ${session?.uid ?? null})
        `);
        await tx.execute(sql`
          INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
          VALUES ('매입지급', 'cash_txn', ${input.cashTxnId}, 'purchase_invoice', ${p.quoteId}, ${p.amount},
                  '확정', '수동', ${session?.uid ?? null}, now())
        `);
      }
      await tx.execute(sql`
        UPDATE cash_txn SET recon_status = '확정', category = COALESCE(category, '매입대금')
        WHERE id = ${input.cashTxnId}
      `);

      const applied = plan.plan.reduce((s, p) => s + p.amount, 0);
      const settled = plan.plan.filter((p) => p.amount === open.find((o) => o.quoteId === p.quoteId)?.remain).length;

      // 별명 학습 — 이 출금 상대명 = 이 거래처 (다음부터 자동 제안)
      try {
        const payer = dep.description.replace(/^\[[^\]]*\]\s*/, "").trim();
        const key = normName(payer);
        if (key.length >= 2) {
          await tx.execute(sql`
            INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
            VALUES (${key}, ${payer}, ${"S:" + supplier}, ${"거래처 " + supplier})
            ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
              party_label = EXCLUDED.party_label, updated_at = now()
          `);
        }
      } catch {
        // 학습 실패는 지급을 막지 않는다
      }

      revalidatePath("/finance/payables");
      revalidatePath("/finance/expenses");
      revalidatePath("/finance/tax"); // CASH_LAT 의 간접 확인(ind)이 바뀐다 (2026 감사 N9)
      revalidatePath("/finance/party");
      revalidatePath("/finance");
      return { ok: true as const, applied, settled, leftover: Number(dep.out_amount) - applied };
    });
  } catch (e) {
    return { ok: false, error: `지급을 넣지 못했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
}
