"use server";

/**
 * ⭐ 돈 추적 화면 — 쓰기 액션 (돈관리 근본책 1단계, 2026-08-31)
 *   잇기는 입금 정리와 같은 정본(linkDepositToQuoteCore)을 부른다 — 판정 중복 금지.
 * 🔴 사장님 전용.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
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

/**
 * ⭐ 「개인계좌·현금으로 받음 — 확인 끝」 (사장님 제보 2026-09-01, 나기춘 93,000)
 *
 *   법인 통장에 안 찍히는 수령(사장님 개인계좌·현장 현금)은 이체입금 자국이 생길 수 없어
 *   인박스·감사 A1 에 영원히 남았다. 자국 표에 **별도수령 자국**(src_table='별도수령')을
 *   남겨 「돈은 받았고, 통장 확인 대상이 아니다」를 기록한다 — 소진량 정본(cashUsedSql)은
 *   src_table='cash_txn' 만 세므로 통장 셈은 안 건드린다. 되돌리기 가능.
 */
export async function markSaleSettledAside(
  quoteId: number,
  undo = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  if (undo) {
    const gone = await db.execute<{ id: number }>(sql`
      DELETE FROM recon_match WHERE kind = '이체입금' AND src_table = '별도수령'
        AND ref_table = 'quote' AND ref_id = ${quoteId} RETURNING id
    `);
    if (gone.length === 0) return { ok: false, error: "별도 수령 표시가 없습니다" };
  } else {
    const [q] = await db.execute<{ id: number; total: number }>(sql`
      SELECT id, total_amount total FROM quote WHERE id = ${quoteId} AND status = '성사'
    `);
    if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
    const dupe = await db.execute<{ id: number }>(sql`
      SELECT id FROM recon_match WHERE kind = '이체입금' AND ref_table = 'quote' AND ref_id = ${quoteId} LIMIT 1
    `);
    if (dupe.length > 0) return { ok: false, error: "이미 입금과 이어졌거나 별도 수령으로 표시된 판매입니다" };
    await db.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('이체입금', '별도수령', 0, 'quote', ${quoteId}, ${Number(q.total)}, '확정', '수동', ${s?.uid ?? null}, now())
    `);
  }
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
