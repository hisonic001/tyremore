"use server";

/**
 * ⭐ 돈 추적 화면 — 쓰기 액션 (돈관리 근본책 1단계, 2026-08-31)
 *   잇기는 입금 정리와 같은 정본(linkDepositToQuoteCore)을 부른다 — 판정 중복 금지.
 * 🔴 사장님 전용.
 */
import { revalidatePath } from "next/cache";
import { getSession, isOwner } from "@/lib/auth";
import { linkDepositToQuoteCore } from "./deposit-core";
import { runAndSaveAudit, type AuditItem } from "./self-audit";
import { revalidateFinance } from "./fin-revalidate";

export async function traceLinkDeposit(
  cashTxnId: number,
  quoteId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  const r = await linkDepositToQuoteCore(cashTxnId, quoteId, s?.uid ?? null, "수동");
  if (!r.ok) return r;
  revalidateFinance();
  revalidatePath("/finance/trace");
  return { ok: true };
}

/** /finance 「지금 검사」 — 매일 아침 cron 과 같은 검사를 즉시 돌린다 */
export async function runAuditNow(): Promise<{ ok: true; items: AuditItem[] } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const r = await runAndSaveAudit();
  revalidatePath("/finance");
  return { ok: true, items: r.items };
}
