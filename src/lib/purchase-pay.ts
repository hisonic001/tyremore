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
import { planSettlement } from "./receivable-plan";

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

/** 지급 기록 지우기 — 잘못 넣었을 때 (수금 removeCollection 의 거울상) */
export async function removePurchasePayment(
  paymentId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const rows = await db.execute<{ id: number }>(sql`
    DELETE FROM purchase_payment WHERE id = ${paymentId} RETURNING id
  `);
  if (rows.length === 0) return { ok: false, error: "지급 기록을 찾을 수 없습니다" };
  revalidatePath("/finance/payables");
  revalidatePath("/finance");
  return { ok: true };
}
