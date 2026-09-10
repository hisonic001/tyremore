"use server";

/**
 * ⭐ 돈 추적 화면 — 쓰기 액션 (돈관리 근본책 1단계, 2026-08-31)
 *   잇기는 입금 정리와 같은 정본(linkDepositToQuoteCore)을 부른다 — 판정 중복 금지.
 * 🔴 사장님 전용.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { linkDepositToQuoteCore } from "./deposit-core";
import { runAndSaveAudit, type AuditItem } from "./self-audit";
import { POS_REASONS } from "./pos-vocab";
import { revalidateFinance } from "./fin-revalidate";

export async function traceLinkDeposit(
  cashTxnId: number,
  quoteId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const s = await getSession();
  const r = await linkDepositToQuoteCore(cashTxnId, quoteId, s?.uid ?? null, "수동");
  if (!r.ok) return r;
  revalidateFinance();
  revalidatePath("/finance/trace");
  return { ok: true };
}

/**
 * ⭐ 「통장 밖에서 정리한 계좌이체 판매 — 확인 끝」 (사장님 제보 2026-09-01, 나기춘 93,000)
 *
 *   법인 통장에 안 찍히는 수령(사장님 개인계좌·현장 현금)은 이체입금 자국이 생길 수 없어
 *   인박스·감사 A1 에 영원히 남았다. 자국 표에 **별도수령 자국**(src_table='별도수령')을
 *   남겨 「이 판매는 통장 확인 대상이 아니다」를 기록한다 — 소진량 정본(cashUsedSql)은
 *   src_table='cash_txn' 만 세므로 통장 셈은 안 건드린다. 되돌리기 가능.
 *
 * 🔴 **판정은 여기 하나** (2026-09-10) — 입금 정리 화면의 [개인 통장으로 받음]·[아직 안 들어옴]은
 *    전에 `pos_note` 에만 적었다. 그런데 `pos_note` 를 읽는 곳은 입금 화면 한 곳뿐이라
 *    감사 A1·홈 인박스·추적 화면에는 사장님이 이미 정리한 건이 영원히 남았다
 *    (실측 2026-09-10: 최근 45일 미확인 31건 중 14건 383만원이 그것). 이제 두 단추도
 *    이 함수를 부르고, `reason` 은 **사람이 읽는 사유**로만 pos_note 에 함께 남긴다.
 *
 * 🔴 「아직 안 들어옴」도 같은 자국이다 — 「받았다」가 아니라 **「통장에서 찾을 일이 아니다」**
 *    라는 뜻이다. 돈이 들어오면 되돌리고(입금 정리·추적 화면의 되돌리기) 이으면 된다.
 *
 * @param reason 사람이 읽는 사유 (POS_REASONS 정본). 없으면 사유 없이 자국만 남긴다.
 */
export async function markSaleSettledAside(
  quoteId: number,
  undo = false,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const s = await getSession();
  const ref = `quote:${quoteId}`;
  if (undo) {
    const gone = await db.execute<{ id: number }>(sql`
      DELETE FROM recon_match WHERE kind = '이체입금' AND src_table = '별도수령'
        AND ref_table = 'quote' AND ref_id = ${quoteId} RETURNING id
    `);
    if (gone.length === 0) return { ok: false, error: "별도 수령 표시가 없습니다" };
    // 사유도 같이 지운다 — 자국만 지우면 사유가 유령으로 남아 화면마다 말이 갈린다
    await db.execute(sql`DELETE FROM pos_note WHERE kind = 'transfer' AND ref = ${ref}`);
  } else {
    if (reason !== undefined && !(POS_REASONS as readonly string[]).includes(reason)) {
      return { ok: false, error: "사유가 올바르지 않습니다" };
    }
    const [q] = await db.execute<{ id: number; total: number; d: string; linked: string }>(sql`
      SELECT q.id, q.total_amount total,
             to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
             COALESCE((SELECT SUM(m.amount) FROM recon_match m
               WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id AND m.status = '확정'), 0)::bigint linked
      FROM quote q WHERE q.id = ${quoteId} AND q.status = '성사'
    `);
    if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
    const dupe = await db.execute<{ id: number }>(sql`
      SELECT id FROM recon_match WHERE kind = '이체입금' AND src_table = '별도수령'
        AND ref_table = 'quote' AND ref_id = ${quoteId} LIMIT 1
    `);
    if (dupe.length > 0) return { ok: false, error: "이미 별도 수령으로 표시한 판매입니다" };
    /* 🔴 남은 돈만 표시한다 (2026-09-10) — 나눠 받은 판매(일부는 통장, 나머지는 개인계좌)에서
       전엔 「이미 입금과 이어졌다」며 거절해 사장님이 정리할 길이 없었다 */
    const remain = Number(q.total) - Number(q.linked);
    if (remain <= 0) return { ok: false, error: "이미 통장 입금과 다 이어진 판매입니다" };
    await db.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('이체입금', '별도수령', 0, 'quote', ${quoteId}, ${remain}, '확정', '수동', ${s?.uid ?? null}, now())
    `);
    if (reason) {
      await db.execute(sql`
        INSERT INTO pos_note (day, kind, ref, reason, memo)
        VALUES (${q.d}::date, 'transfer', ${ref}, ${reason}, NULL)
        ON CONFLICT (ref) DO UPDATE SET reason = EXCLUDED.reason, memo = NULL, day = EXCLUDED.day
        -- 🔴 카드 일마감이 같은 열쇠(quote:ID)로 남긴 사유는 덮지 않는다 — 자국은 이미 심었고,
        --    사유는 사람이 읽는 말일 뿐이라 남의 말을 지우면서까지 적을 것은 아니다
        WHERE pos_note.kind = 'transfer'
      `);
    }
  }
  revalidateFinance();
  revalidatePath("/finance/trace");
  return { ok: true };
}

/** /finance 「지금 검사」 — 매일 아침 cron 과 같은 검사를 즉시 돌린다 */
export async function runAuditNow(): Promise<{ ok: true; items: AuditItem[] } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const r = await runAndSaveAudit();
  revalidatePath("/finance");
  return { ok: true, items: r.items };
}
