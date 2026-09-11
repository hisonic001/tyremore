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
import { getSession, hasPerm } from "@/lib/auth";
import { SPLITTABLE, EXCLUSIVE } from "@/lib/payments";
import { updateSaleHead } from "./sale-edit";
import { autoMatchPosDayCore, forgetMatches, insertMatch, parseAppKey, posDayData, type AppKind } from "./pos-close";
import { POS_REASONS, PREPAID_REASON, RECON_METHODS } from "./pos-vocab";
import { revalidateFinance } from "./fin-revalidate";
import { logActivity } from "./fin-activity";
import type { UndoItem } from "./fin-activity-types";
import { W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 기록 label 용 — 판매 번호·이름 (한 번 읽는다) */
async function saleLabel(quoteId: number): Promise<{ no: string; who: string; pm: string | null; day: string } | null> {
  const [q] = await db.execute<{ no: string; who: string; pm: string | null; day: string }>(sql`
    SELECT q.quote_no no, COALESCE(q.supplier_name, c.name, '손님') who, q.payment_method pm,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') AS "day"
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id WHERE q.id = ${quoteId}
  `);
  return q ?? null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_TABLE = { quote: "quote", qp: "quote_payment", rp: "receivable_payment" } as const;

async function guard(): Promise<{ ok: true; uid: number | null } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
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

/** 그 앱 항목의 남은 돈 — quote 는 총액, 분할·수금은 그 줄의 금액 (quoteId 는 기록 label 용) */
async function appRemain(kind: AppKind, id: number): Promise<{ amount: number; remain: number; quoteId: number } | null> {
  const table = REF_TABLE[kind];
  const linked = sql`(SELECT COALESCE(SUM(rm.amount), 0) FROM recon_match rm
    WHERE rm.kind = '포스결제' AND rm.status = '확정' AND rm.ref_table = ${table} AND rm.ref_id = t.id)`;
  const [r] =
    kind === "quote"
      ? await db.execute<{ amount: number; linked: string; quote_id: number }>(sql`
          SELECT t.total_amount amount, ${linked} linked, t.id quote_id FROM quote t WHERE t.id = ${id}
        `)
      : kind === "qp"
        ? await db.execute<{ amount: number; linked: string; quote_id: number }>(sql`
            SELECT t.amount, ${linked} linked, t.quote_id FROM quote_payment t WHERE t.id = ${id}
          `)
        : await db.execute<{ amount: number; linked: string; quote_id: number }>(sql`
            SELECT t.amount, ${linked} linked, t.quote_id FROM receivable_payment t WHERE t.id = ${id}
          `);
  if (!r) return null;
  return { amount: Number(r.amount), remain: Number(r.amount) - Number(r.linked), quoteId: Number(r.quote_id) };
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
  if (p.remain <= 0) return { ok: false, error: `이 POS 결제는 이미 다 ${W.recon}됐습니다 — 먼저 풀어 주세요` };
  const a = await appRemain(k.kind, k.id);
  if (!a) return { ok: false, error: "판매 항목을 찾을 수 없습니다" };
  if (a.remain <= 0) return { ok: false, error: "이 판매는 이미 다 채워졌습니다 — 먼저 풀어 주세요" };
  const amount = Math.min(p.remain, a.remain);
  const made = await insertMatch(posId, k.kind, k.id, amount, "수동", g.uid);
  if (!made) return { ok: false, error: `이미 ${W.recon}된 짝입니다 — 먼저 풀어 주세요` };
  await db.execute(sql`DELETE FROM pos_note WHERE ref IN (${"pos:" + posId}, ${appKeyStr})`);
  /* ⭐ 최근 한 일 — 되돌리기 = unlinkMatch(matchId) */
  const q = await saleLabel(a.quoteId);
  await logActivity({
    ym: p.day.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "대사",
    target: { table: "recon_match", id: made },
    amount,
    label: `POS ${p.day.slice(5)} ${won(amount)} ↔ ${q?.no ?? appKeyStr} ${q?.who ?? ""} (${W.reconCard})`,
    undo: { kind: "pos", args: { matchId: made } },
  });
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
  if (ids.length > 10) return { ok: false, error: `한 번에 10건까지 ${W.recon}할 수 있습니다` };
  const a0 = await appRemain(k.kind, k.id);
  let left = a0?.remain ?? 0;
  if (left <= 0) return { ok: false, error: "이 판매는 이미 다 채워졌습니다 — 먼저 풀어 주세요" };
  let n = 0;
  let total = 0;
  const items: UndoItem[] = [];
  let day = "";
  for (const posId of ids) {
    if (left <= 0) break;
    const p = await posRemain(posId);
    if (!p || p.remain <= 0) continue;
    const amount = Math.min(p.remain, left);
    const made = await insertMatch(posId, k.kind, k.id, amount, "수동", g.uid);
    if (!made) continue;
    await db.execute(sql`DELETE FROM pos_note WHERE ref = ${"pos:" + posId}`);
    left -= amount;
    total += amount;
    n++;
    day ||= p.day;
    items.push({ kind: "pos", args: { matchId: made }, label: `POS ${p.day.slice(5)} ${won(amount)}`, amount });
  }
  if (n === 0) return { ok: false, error: `${W.recon}할 수 있는 건이 없습니다 — 이미 ${W.recon}됐거나 남은 돈이 없습니다` };
  await db.execute(sql`DELETE FROM pos_note WHERE ref = ${appKeyStr}`);
  /* ⭐ 최근 한 일 — POS 여러 건 ↔ 판매 하나: 한 줄 n건, 건별 되돌리기 = unlinkMatch(matchId) */
  const q = await saleLabel(a0!.quoteId);
  await logActivity({
    ym: day.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "대사",
    target: { table: "quote", id: a0!.quoteId },
    n,
    amount: total,
    label: `POS ${n}건 ${won(total)} ↔ ${q?.no ?? appKeyStr} ${q?.who ?? ""} (${W.reconCard}, 나눠 긁음)`,
    undo: { kind: "bulk", args: { items } },
  });
  refresh();
  return { ok: true, n, amount: total };
}

/** 자국 한 줄만 풀기 */
export async function unlinkMatch(matchId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await forgetMatches(sql`id = ${matchId} AND kind = '포스결제'`, "한 줄 풀기", g.uid); // 기록은 forgetMatches 가
  if (rows === 0) return { ok: false, error: `${W.recon}된 ${W.reconLog}이 없습니다` };
  refresh();
  return { ok: true };
}

/** 그 POS 건의 자국을 통째로 풀기 (여러 판매에 나눠 붙였을 때) */
export async function unlinkPos(posId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const rows = await forgetMatches(
    sql`kind = '포스결제' AND src_table = 'pos_txn' AND src_id = ${posId}`,
    "POS 건 통째로 풀기",
    g.uid,
  );
  if (rows === 0) return { ok: false, error: `${W.recon}된 ${W.reconLog}이 없습니다` };
  refresh();
  return { ok: true };
}

/**
 * 미매칭 건에 사유 남기기 — 목록은 pos-close.POS_REASONS 정본 하나 (전엔 서버·화면이 갈려 있었다)
 *
 * 🔴 kind 에서 'transfer' 를 뺐다 (2026-09-10) — 계좌이체 판매의 정리는 **사유가 아니라 판정**이다.
 *    `pos_note` 를 읽는 곳은 입금 화면 하나뿐이라, 여기에만 적으면 감사 A1·홈 인박스·추적
 *    화면엔 사장님이 이미 정리한 건이 영원히 남았다. 이제 trace-actions.markSaleSettledAside
 *    가 자국(recon_match)을 남기고 사유를 함께 적는다 — 부르는 곳을 컴파일러가 막게 타입에서 뺀다.
 */
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
  /* ⭐ 최근 한 일 — 선결제·아직 안 들어옴은 「보류」, 나머지 사유는 「제외」. 되돌리기 = clearPosNote(ref)
     🔴 args: ref 는 "pos:12" 꼴 그대로(clearPosNote 의 인자), refTable·refId 는 그걸 쪼갠 것 */
  const [refTable, refIdStr] = input.ref.split(":");
  const hold = input.reason === PREPAID_REASON || input.reason === "아직 안 들어옴";
  await logActivity({
    ym: input.day.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: hold ? "보류" : "제외",
    label: `${hold ? W.hold : W.ignore}: ${input.kind === "pos_only" ? "POS 결제" : "앱 판매"} ${input.ref} — ${input.reason}${input.memo?.trim() ? ` (${input.memo.trim()})` : ""} (${input.day.slice(5)})`,
    undo: { kind: "note", args: { ref: input.ref, refTable, refId: Number(refIdStr) } },
  });
  refresh();
  return { ok: true };
}

export async function clearPosNote(ref: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const gone = await db.execute<{ reason: string; d: string }>(sql`
    DELETE FROM pos_note WHERE ref = ${ref} RETURNING reason, to_char(day, 'YYYY-MM-DD') d
  `);
  if (gone[0]) {
    await logActivity({
      ym: gone[0].d.slice(0, 7),
      actor: g.uid,
      how: "사람",
      verb: "되돌리기",
      label: `${W.undo}: 사유 지우기 ${ref} — ${gone[0].reason}`,
    });
  }
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
  const before = await saleLabel(quoteId); // 기록에 이전 값을 남기려고
  const r = await updateSaleHead({ quoteId, paymentMethod: method, payments: null });
  if (!r.ok) return r;
  /* ⭐ 최근 한 일 — 수정은 되돌리기 없음, 이전 값이 label 에 (자동 대조 n건은 autoMatchPosDayCore 가 따로 남긴다) */
  await logActivity({
    ym: (before?.day ?? day).slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "수정",
    target: { table: "quote", id: quoteId },
    label: `수정: 판매 ${before?.no ?? `#${quoteId}`} ${before?.who ?? ""} 결제 ${before?.pm ?? "?"} → ${method} (단말기 기준)`,
  });
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
  const before = await saleLabel(quoteId);
  const r = await updateSaleHead({ quoteId, paymentMethod: method, payments: null });
  if (!r.ok) return r;
  await logActivity({
    ym: before?.day.slice(0, 7) ?? null,
    actor: g.uid,
    how: "사람",
    verb: "수정",
    target: { table: "quote", id: quoteId },
    label: `수정: 판매 ${before?.no ?? `#${quoteId}`} ${before?.who ?? ""} 결제 ${before?.pm ?? "?"} → ${method}`,
  });
  refresh();
  return { ok: true };
}

/** 날짜 착오 — 그 판매의 작업일을 이 날로 옮기고 바로 자동 대조 */
export async function moveSaleDate(quoteId: number, day: string): Promise<{ ok: true; matched: number } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  if (!DAY_RE.test(day)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const before = await saleLabel(quoteId);
  const r = await updateSaleHead({ quoteId, workDate: day });
  if (!r.ok) return r;
  await logActivity({
    ym: day.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "수정",
    target: { table: "quote", id: quoteId },
    label: `수정: 판매 ${before?.no ?? `#${quoteId}`} ${before?.who ?? ""} 작업일 ${before?.day ?? "?"} → ${day}`,
  });
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
  if (data.openN > 0) return { ok: false, error: `아직 남은 건이 ${data.openN}건 있습니다 — ${W.recon}하거나 사유를 남겨 주세요` };
  await db.execute(sql`
    INSERT INTO pos_close (day, closed_by, pos_card_total, app_card_total, matched_n, notes)
    VALUES (${day}::date, ${g.uid}, ${data.posTotal}, ${data.appTotal}, ${data.matches.length},
            ${JSON.stringify([...data.posOpen, ...data.appOpen].filter((x) => x.note).map((x) => x.note))}::jsonb)
    ON CONFLICT (day) DO UPDATE SET closed_at = now(), closed_by = EXCLUDED.closed_by,
      pos_card_total = EXCLUDED.pos_card_total, app_card_total = EXCLUDED.app_card_total,
      matched_n = EXCLUDED.matched_n, notes = EXCLUDED.notes
  `);
  /* ⭐ 최근 한 일 — 되돌리기 = reopenPosDay(day) */
  await logActivity({
    ym: day.slice(0, 7),
    actor: g.uid,
    how: "사람",
    verb: "마감",
    n: Math.max(1, data.matches.length),
    amount: data.posTotal,
    label: `카드 일마감 ${day.slice(5)} · ${data.matches.length}건 · 단말기 ${won(data.posTotal)}`,
    undo: { kind: "posClose", args: { day } },
  });
  refresh();
  return { ok: true };
}

export async function reopenPosDay(day: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return g;
  const gone = await db.execute<{ day: string }>(sql`DELETE FROM pos_close WHERE day = ${day}::date RETURNING to_char(day, 'YYYY-MM-DD') AS "day"`);
  if (gone.length > 0) {
    await logActivity({
      ym: day.slice(0, 7),
      actor: g.uid,
      how: "사람",
      verb: "되돌리기",
      label: `${W.undo}: 카드 일마감 풀기 ${day.slice(5)}`,
    });
  }
  refresh();
  return { ok: true };
}
