"use server";

/**
 * ⭐ 렌트카 거래처 월 정산 — 화면이 부르는 문 (사장님 요청 2026-09-01)
 *
 *   실제 일은 settlement-apply.ts 코어가 한다. 여기는 세 가지만:
 *   ① 사장님 전용 게이트 (돈 관리 기준 — receivable.ts 와 같음)
 *   ② 화면 새로고침 (revalidatePath)
 *   ③ 입금 반영 (settleReceivables 정본이 이미 게이트를 갖고 있어 코어 밖)
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { isOwner } from "./auth";
import { settleReceivables } from "./receivable";
import {
  addNewSalesCore,
  applySettlementCore,
  approveRestCore,
  deleteRunCore,
  reopenRunCore,
  saveDecisionCore,
  saveMatchedDecisionsCore,
  startSettlementCore,
  type ApplyLineResult,
  type ItemInstruction,
} from "./settlement-apply";

export type { ApplyLineResult, ItemInstruction };

const OWNER_ONLY = { ok: false as const, error: "정산은 사장님 계정 전용입니다" };

function refresh() {
  for (const p of ["/receivables", "/receivables/settle", "/sales", "/"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export async function startSettlement(supplier: string, ym: string) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await startSettlementCore(supplier, ym);
  refresh();
  return r;
}

export async function addNewSales(runId: number) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await addNewSalesCore(runId);
  refresh();
  return r;
}

export async function saveDecision(input: Parameters<typeof saveDecisionCore>[0]) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await saveDecisionCore(input);
  refresh();
  return r;
}

export async function saveMatchedDecisions(
  runId: number,
  rows: { lineId: number; agreed: number | null; matchedBy: string; memo: string }[],
) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await saveMatchedDecisionsCore(runId, rows);
  refresh();
  return r;
}

export async function approveRest(runId: number) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await approveRestCore(runId);
  refresh();
  return r;
}

export async function applySettlement(runId: number) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await applySettlementCore(runId);
  refresh();
  return r;
}

export async function reopenRun(runId: number) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await reopenRunCore(runId);
  refresh();
  return r;
}

export async function deleteRun(runId: number) {
  if (!(await isOwner())) return OWNER_ONLY;
  const r = await deleteRunCore(runId);
  refresh();
  return r;
}

/**
 * 입금 반영 — 회차의 열린 외상 건들에 묶음 수금(settleReceivables 정본 그대로).
 * 관리대장의 「입금일·입금금액」 자리도 여기서 찍힌다.
 */
export async function markDeposited(input: {
  runId: number;
  method: string;
  paidOn: string;
  /** 실제 입금 총액 — 비우면 회차 잔액 전부 */
  received?: number | null;
  memo?: string | null;
}): Promise<
  | { ok: true; settled: number; applied: number; partialQuoteNo: string | null }
  | { ok: false; error: string }
> {
  if (!(await isOwner())) return OWNER_ONLY;
  const open = await db.execute<{ quote_id: number }>(sql`
    SELECT l.quote_id
    FROM settlement_line l
    JOIN quote q ON q.id = l.quote_id
    WHERE l.run_id = ${input.runId} AND q.status = '성사' AND q.payment_method = '외상'
      AND q.total_amount > COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0)
  `);
  if (open.length === 0) return { ok: false, error: "받을 잔액이 남은 건이 없습니다" };

  const r = await settleReceivables({
    quoteIds: open.map((o) => Number(o.quote_id)),
    method: input.method,
    paidOn: input.paidOn,
    memo: input.memo ?? null,
    received: input.received ?? null,
  });
  if (!r.ok) return r;

  await db.execute(sql`
    UPDATE settlement_run SET
      deposited_on = ${input.paidOn},
      deposited_amount = COALESCE(deposited_amount, 0) + ${r.applied},
      status = '입금완료', updated_at = now()
    WHERE id = ${input.runId}
  `);
  refresh();
  return r;
}
