"use server";

/**
 * ⭐ 카드매출 일마감 — 쓰기 액션 (사장님 요청 2026-08-26)
 *   자동 대조 · 손으로 잇기/풀기 · 사유 남기기 · 수단/날짜 고치기(sale-edit 재사용) · 일마감/풀기.
 *
 * ⭐ 2026-08-29 — 금액을 나눠 붙일 수 있게 (사장님 제보 "예외사항들이 많음")
 *   · linkPos 는 「이 POS 의 남은 돈」과 「이 판매의 남은 돈」 중 **작은 쪽**만 붙인다.
 *     → 부분 결제·선결제·추가 결제가 자연히 풀린다. 날짜가 달라도 붙일 수 있다.
 *   · linkPosMulti 로 여러 POS 건을 한 판매에 한꺼번에 (카드 두 장으로 나눠 긁기).
 *   · unlinkMatch 로 자국 한 줄만 푼다 (전엔 그 POS 의 자국을 통째로 지웠다).
 *
 * 🔴 사장님 전용. 질의 순차. 되돌리기 가능(자국 삭제·사유 삭제·마감 풀기).
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, isOwner } from "@/lib/auth";
import { SPLITTABLE, EXCLUSIVE } from "@/lib/payments";
import { updateSaleHead } from "./sale-edit";
import { autoMatchPosDayCore, insertMatch, parseAppKey, posDayData, type AppKind } from "./pos-close";
import { POS_REASONS, RECON_METHODS } from "./pos-vocab";
import { revalidateFinance } from "./fin-revalidate";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_TABLE = { quote: "quote", qp: "quote_payment", rp: "receivable_payment" } as const;

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  const s = await getSession();
  return { ok: true, uid: s?.uid ?? null };
}
function refresh() {
  revalidateFinance();
  revalidatePath("/sales");
}

/** 그 POS 건의 남은 돈 */
async function posRemain(posId: number): Promise<{ amount: number; remain: number; day: string } | null> {
  const [p] = await db.execute<{ amount: number; day: string; linked: string }>(sql`
    SELECT p.amount, to_char(p.day, 'YYYY-MM-DD') AS "day",
           (SELECT COALESCE(SUM(rm.amount), 0) FROM recon_match rm
             WHERE rm.kind = '포스결제' AND rm.status = '확정'
               AND rm.src_table = 'pos_txn' AND rm.src_id = p.id) linked
    FROM pos_txn p WHERE p.id = ${posId} AND p.is_active
  `);
  if (!p) return null;
  return { amount: Number(p.amount), remain: Number(p.amount) - Number(p.linked), day: p.day };
}

/** 그 앱 항목의 남은 돈 — quote 는 총액, 분할·수금은 그 줄의 금액 */
async function appRemain(kind: AppKind, id: number): Promise<{ amount: number; remain: number } | null> {
  const table = REF_TABLE[kind];
  const linked = sql`(SELECT COALESCE(SUM(rm.amount), 0) FROM recon_match rm
    WHERE rm.kind = '포스결제' AND rm.status = '확정' AND rm.ref_table = ${table} AND rm.ref_id = t.id)`;
  const [r] =
    kind === "quote"
      ? await db.execute<{ amount: number; linked: string }>(sql`
          SELECT t.total_amount amount, ${linked} linked FROM quote t WHERE t.id = ${id}
        `)
      : kind === "qp"
        ? await db.execute<{ amount: number; linked: string }>(sql`
            SELECT t.amount, ${linked} linked FROM quote_payment t WHERE t.id = ${id}
          `)
        : await db.execute<{ amount: number; linked: string }>(sql`
            SELECT t.amount, ${linked} linked FROM receivable_payment t WHERE t.id = ${id}
          `);
  if (!r) return null;
  return { amount: Number(r.amount), remain: Number(r.amount) - Number(r.linked) };
}

export async function autoMatchPosDay(day: string): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const matched = await autoMatchPosDayCore(day, g.uid);
  refresh();
  return { ok: true, matched };
}

/**
 * POS 결제 한 건을 앱 판매 항목에 붙인다 — 남은 돈끼리 작은 쪽만.
 * 날짜가 달라도 된다 (미리 받은 돈·나중에 받은 돈).
 */
export async function linkPos(
  posId: number,
  appKeyStr: string,
): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const k = parseAppKey(appKeyStr);
  if (!k) return { ok: false, error: "판매 항목이 올바르지 않습니다" };
  const p = await posRemain(posId);
  if (!p) return { ok: false, error: "POS 결제 건을 찾을 수 없습니다" };
  if (p.remain <= 0) return { ok: false, error: "이 POS 결제는 이미 다 붙었습니다 — 먼저 풀어 주세요" };
  const a = await appRemain(k.kind, k.id);
  if (!a) return { ok: false, error: "판매 항목을 찾을 수 없습니다" };
  if (a.remain <= 0) return { ok: false, error: "이 판매는 이미 다 채워졌습니다 — 먼저 풀어 주세요" };
  const amount = Math.min(p.remain, a.remain);
  const made = await insertMatch(posId, k.kind, k.id, amount, "수동", g.uid);
  if (!made) return { ok: false, error: "이미 이어진 짝입니다 — 먼저 풀어 주세요" };
  await db.execute(sql`DELETE FROM pos_note WHERE ref IN (${"pos:" + posId}, ${appKeyStr})`);
  refresh();
  return { ok: true, amount };
}

/** 여러 POS 건을 한 판매에 한꺼번에 (카드 두 장으로 나눠 긁은 경우) */
export async function linkPosMulti(
  posIds: number[],
  appKeyStr: string,
): Promise<{ ok: true; n: number; amount: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const k = parseAppKey(appKeyStr);
  if (!k) return { ok: false, error: "판매 항목이 올바르지 않습니다" };
  const ids = [...new Set(posIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return { ok: false, error: "POS 결제 건을 골라 주세요" };
  if (ids.length > 10) return { ok: false, error: "한 번에 10건까지 붙일 수 있습니다" };
  let left = (await appRemain(k.kind, k.id))?.remain ?? 0;
  if (left <= 0) return { ok: false, error: "이 판매는 이미 다 채워졌습니다 — 먼저 풀어 주세요" };
  let n = 0;
  let total = 0;
  for (const posId of ids) {
    if (left <= 0) break;
    const p = await posRemain(posId);
    if (!p || p.remain <= 0) continue;
    const amount = Math.min(p.remain, left);
    if (!(await insertMatch(posId, k.kind, k.id, amount, "수동", g.uid))) continue;
    await db.execute(sql`DELETE FROM pos_note WHERE ref = ${"pos:" + posId}`);
    left -= amount;
    total += amount;
    n++;
  }
  if (n === 0) return { ok: false, error: "붙일 수 있는 건이 없습니다 — 이미 이어졌거나 남은 돈이 없습니다" };
  await db.execute(sql`DELETE FROM pos_note WHERE ref = ${appKeyStr}`);
  refresh();
  return { ok: true, n, amount: total };
}

/** 자국 한 줄만 풀기 */
export async function unlinkMatch(matchId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await db.execute<{ id: number }>(sql`
    DELETE FROM recon_match WHERE id = ${matchId} AND kind = '포스결제' RETURNING id
  `);
  if (rows.length === 0) return { ok: false, error: "이어진 자국이 없습니다" };
  refresh();
  return { ok: true };
}

/** 그 POS 건의 자국을 통째로 풀기 (여러 판매에 나눠 붙였을 때) */
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

/** 미매칭 건에 사유 남기기 — 목록은 pos-close.POS_REASONS 정본 하나 (전엔 서버·화면이 갈려 있었다) */
export async function setPosNote(input: {
  day: string;
  kind: "pos_only" | "app_only" | "transfer";
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

/**
 * 수단 착오 — 앱에 다른 수단으로 적힌 판매를 POS 가 말하는 수단으로 고치고 바로 자동 대조.
 * ⭐ 2026-08-29: 무엇으로 고칠지를 받는다 (전엔 늘 「카드」였다 — 간편결제가 생겨 갈렸다).
 */
export async function fixSaleToPos(
  quoteId: number,
  day: string,
  method: string,
): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(RECON_METHODS as readonly string[]).includes(method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const r = await updateSaleHead({ quoteId, paymentMethod: method, payments: null });
  if (!r.ok) return r;
  const matched = DAY_RE.test(day) ? await autoMatchPosDayCore(day, g.uid) : 0;
  refresh();
  return { ok: true, matched };
}

/** 결제수단 고치기 (계좌이체로 적혔는데 현금이었다 등) — 정비내역의 「날짜·결제 고치기」와 같은 정본 */
export async function fixSaleMethod(quoteId: number, method: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const allowed: readonly string[] = [...SPLITTABLE, ...EXCLUSIVE];
  if (!allowed.includes(method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const r = await updateSaleHead({ quoteId, paymentMethod: method, payments: null });
  if (!r.ok) return r;
  refresh();
  return { ok: true };
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
    VALUES (${day}::date, ${g.uid}, ${data.posTotal}, ${data.appTotal}, ${data.matches.length},
            ${JSON.stringify([...data.posOpen, ...data.appOpen].filter((x) => x.note).map((x) => x.note))}::jsonb)
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
