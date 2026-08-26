"use server";

/**
 * ⭐ 카드매출 일마감 — 쓰기 액션 (사장님 요청 2026-08-26)
 *   자동 대조 · 손으로 잇기/풀기 · 사유 남기기 · 수단/날짜 고치기(sale-edit 재사용) · 일마감/풀기.
 * 🔴 사장님 전용. 질의 순차. 되돌리기 가능(자국 삭제·사유 삭제·마감 풀기).
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { updateSaleHead } from "./sale-edit";
import { autoMatchPosDayCore, parseAppKey, posDayData } from "./pos-close";
import { revalidateFinance } from "./fin-revalidate";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_TABLE = { quote: "quote", qp: "quote_payment", rp: "receivable_payment" } as const;
const POS_REASONS = ["단말기 누락", "앱 미등록", "취소", "다른 날", "기타"] as const;

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}
function refresh() {
  revalidateFinance();
  revalidatePath("/sales");
}

export async function autoMatchPosDay(day: string): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const matched = await autoMatchPosDayCore(day, g.uid);
  refresh();
  return { ok: true, matched };
}

/** POS 결제 한 건 ↔ 앱 판매 항목 손으로 잇기 */
export async function linkPos(posId: number, appKeyStr: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const k = parseAppKey(appKeyStr);
  if (!k) return { ok: false, error: "판매 항목이 올바르지 않습니다" };
  const [p] = await db.execute<{ id: number; amount: number; day: string }>(sql`
    SELECT id, amount, to_char(day, 'YYYY-MM-DD') AS "day" FROM pos_txn WHERE id = ${posId} AND is_active
  `);
  if (!p) return { ok: false, error: "POS 결제 건을 찾을 수 없습니다" };
  const [dupe] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM recon_match WHERE kind = '포스결제' AND status = '확정'
      AND ((src_table = 'pos_txn' AND src_id = ${posId}) OR (ref_table = ${REF_TABLE[k.kind]} AND ref_id = ${k.id}))
  `);
  if (Number(dupe.n) > 0) return { ok: false, error: "이미 이어진 건입니다 — 먼저 풀어 주세요" };
  await db.execute(sql`
    INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
    VALUES ('포스결제', 'pos_txn', ${posId}, ${REF_TABLE[k.kind]}, ${k.id}, ${p.amount}, '확정', '수동', ${g.uid}, now())
  `);
  await db.execute(sql`DELETE FROM pos_note WHERE ref IN (${"pos:" + posId}, ${appKeyStr})`);
  refresh();
  return { ok: true };
}

export async function unlinkPos(posId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number }>(sql`
    DELETE FROM recon_match WHERE kind = '포스결제' AND src_table = 'pos_txn' AND src_id = ${posId} RETURNING id
  `);
  if (rows.length === 0) return { ok: false, error: "이어진 자국이 없습니다" };
  refresh();
  return { ok: true };
}

/** 미매칭 건에 사유 남기기 — 단말기 누락·앱 미등록·취소·다른 날·기타 */
export async function setPosNote(input: {
  day: string;
  kind: "pos_only" | "app_only";
  ref: string;
  reason: string;
  memo?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(input.day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  if (!(POS_REASONS as readonly string[]).includes(input.reason)) return { ok: false, error: "사유가 올바르지 않습니다" };
  if (!/^(pos|quote|qp|rp):\d+$/.test(input.ref)) return { ok: false, error: "대상이 올바르지 않습니다" };
  await db.execute(sql`
    INSERT INTO pos_note (day, kind, ref, reason, memo)
    VALUES (${input.day}::date, ${input.kind}, ${input.ref}, ${input.reason}, ${input.memo?.trim() || null})
    ON CONFLICT (ref) DO UPDATE SET reason = EXCLUDED.reason, memo = EXCLUDED.memo, day = EXCLUDED.day, kind = EXCLUDED.kind
  `);
  refresh();
  return { ok: true };
}

export async function clearPosNote(ref: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  await db.execute(sql`DELETE FROM pos_note WHERE ref = ${ref}`);
  refresh();
  return { ok: true };
}

/** 수단 착오 — 앱엔 현금·이체로 적힌 판매를 카드로 고치고 바로 자동 대조 */
export async function fixSaleToCard(quoteId: number, day: string): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const r = await updateSaleHead({ quoteId, paymentMethod: "카드", payments: null });
  if (!r.ok) return r;
  const matched = DAY_RE.test(day) ? await autoMatchPosDayCore(day, g.uid) : 0;
  refresh();
  return { ok: true, matched };
}

/** 날짜 착오 — 그 판매의 작업일을 이 날로 옮기고 바로 자동 대조 */
export async function moveSaleDate(quoteId: number, day: string): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const r = await updateSaleHead({ quoteId, workDate: day });
  if (!r.ok) return r;
  const matched = await autoMatchPosDayCore(day, g.uid);
  refresh();
  return { ok: true, matched };
}

export async function closePosDay(day: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const data = await posDayData(day);
  if (!data.hasPos) return { ok: false, error: "이 날 POS 자료가 없습니다 — 매출리포트를 먼저 올려 주세요" };
  if (data.openN > 0) return { ok: false, error: `아직 남은 건이 ${data.openN}건 있습니다 — 잇거나 사유를 남겨 주세요` };
  await db.execute(sql`
    INSERT INTO pos_close (day, closed_by, pos_card_total, app_card_total, matched_n, notes)
    VALUES (${day}::date, ${g.uid}, ${data.posCardTotal}, ${data.appCardTotal}, ${data.pairs.length},
            ${JSON.stringify([...data.posOnly, ...data.appOnly].filter((x) => x.note).map((x) => x.note))}::jsonb)
    ON CONFLICT (day) DO UPDATE SET closed_at = now(), closed_by = EXCLUDED.closed_by,
      pos_card_total = EXCLUDED.pos_card_total, app_card_total = EXCLUDED.app_card_total,
      matched_n = EXCLUDED.matched_n, notes = EXCLUDED.notes
  `);
  refresh();
  return { ok: true };
}

export async function reopenPosDay(day: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  await db.execute(sql`DELETE FROM pos_close WHERE day = ${day}::date`);
  refresh();
  return { ok: true };
}
