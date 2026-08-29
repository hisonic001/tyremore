/**
 * ⭐ 카드매출 일마감 — 토스 포스 결제 건 ↔ 앱 판매 대조 정본 (사장님 요청 2026-08-26)
 *
 *   "매일 매출리포트를 내려받아 앱 판매내역과 자동 대조하며 카드매출을 일마감하고 싶다."
 *   정본 = POS 결제 건(실제로 긁힌 돈). 앱 판매는 그에 맞춰 고친다(수단 착오·미등록·날짜 착오).
 *
 * ⭐ 2026-08-29 개편 (사장님 제보 — "카드 일마감시 예외사항들이 많음")
 *   ① 간편결제(QR·네이버페이·카카오페이·토스페이)를 카드와 나란히 대사한다.
 *      토스 포스는 「QR결제」로 적어 오고 여신협회 승인내역에는 안 잡힌다
 *      (실측 2026-08-28: QR결제 7줄 — 토스페이 305,000 · 현대 120,000 · 삼성 200,000 + 취소 2쌍).
 *   ② **금액을 나눠 붙일 수 있다.** 자국 한 줄이 「이 POS 건의 얼마가 이 판매에 갔는지」다.
 *      → 카드 두 장으로 나눠 긁기(POS 여럿 = 판매 하나)도, 한 번 긁어 두 건 치르기
 *        (POS 하나 = 판매 여럿)도, 미리 받고 나중에 더 받기(부분·선결제)도 같은 얼개로 풀린다.
 *      양쪽 다 「붙은 돈 / 남은 돈」을 갖는다. 남은 돈이 0이면 끝난 것이다.
 *   ③ 다른 날 후보를 앞뒤 1일 → **앞뒤 7일**로 넓혔다. 미리 결제·나중 결제가 여기 걸린다.
 *   ④ 「선결제 — 판매는 나중에」 사유를 새로 뒀다. 그 건은 판매가 생길 때까지 계속 따라다닌다.
 *
 *   앱 쪽 대사 항목 = quote 단일(총액) + quote_payment 분할 몫 + receivable_payment 수금.
 *   자국 = recon_match kind '포스결제' (src pos_txn → ref quote | quote_payment | receivable_payment).
 *   🔴 자국은 **짝 단위로 유일**하다 (scripts/add-easypay.ts 의 uq_recon_match_pos).
 *
 * 🔴 "use server" 아님 — 페이지·액션·ingest 가 부른다. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isReconPos, NEARBY_DAYS, POS_TO_APP, PREPAID_REASON, RECON_METHODS, RECON_POS_METHODS } from "./pos-vocab";

/* ------------------------------------------------------------------ */
/* 어휘 — 낱말은 pos-vocab.ts 가 정본 (화면이 DB 없이 가져다 쓸 수 있게) */

export {
  POS_TO_APP,
  RECON_METHODS,
  RECON_POS_METHODS,
  NEARBY_DAYS,
  PREPAID_REASON,
  POS_REASONS,
} from "./pos-vocab";

/* ------------------------------------------------------------------ */

export interface PosRow {
  id: number;
  /** HH:MM:SS */
  at: string;
  paidAt: string;
  day: string;
  /** 토스 포스 원어 — 카드 · QR결제 · 선불지급수단 … */
  method: string;
  /** 앱 낱말 — 카드 · 간편결제 */
  appMethod: string;
  cardCo: string | null;
  amount: number;
  isCancel: boolean;
  /** 판매에 이미 붙은 금액 */
  linked: number;
  /** 아직 안 붙은 금액 */
  remain: number;
}

export type AppKind = "quote" | "qp" | "rp";

export interface AppItem {
  /** 'quote:ID' | 'qp:ID' | 'rp:ID' */
  key: string;
  kind: AppKind;
  refId: number;
  quoteId: number;
  quoteNo: string;
  who: string;
  amount: number;
  /** HH:MM (등록 시각) */
  at: string | null;
  /** 판 날 (수금이면 수금일) */
  day: string;
  /** 앱에 적힌 수단 — '카드' · '간편결제' */
  method: string;
  /** 화면 꼬리표 — '카드' · '혼합의 간편결제' · '외상 카드수금' */
  pm: string;
  linked: number;
  remain: number;
}

export interface PosNote {
  id: number;
  kind: "pos_only" | "app_only";
  ref: string;
  reason: string;
  memo: string | null;
}

/** POS 건에 붙일 수 있는 「한 번 누르기」 후보 */
export type PosOnlyCand =
  | { kind: "fixMethod"; quoteId: number; toMethod: string; label: string }
  | { kind: "moveDate"; quoteId: number; fromDay: string; label: string }
  | { kind: "linkApp"; appKey: string; amount: number; exact: boolean; label: string };

/** 앱 항목에 붙일 수 있는 「한 번 누르기」 후보 */
export type AppOnlyCand =
  | { kind: "linkPos"; posId: number; day: string; amount: number; exact: boolean; label: string }
  | { kind: "linkPosMulti"; posIds: number[]; amount: number; label: string }
  /** 앱엔 카드로 적혔는데 POS 는 간편결제라고 한다 — 고치면 자동으로 짝이 맞는다 */
  | { kind: "fixSelfMethod"; quoteId: number; toMethod: string; label: string };

export interface PosMatch {
  /** recon_match.id — 이 자국 하나만 푼다 */
  id: number;
  pos: PosRow;
  app: AppItem;
  amount: number;
  /** 자동 · 수동 · 조정 */
  method: string;
}

export interface PosDayData {
  day: string;
  hasPos: boolean;
  /** 그 날 살아 있는 대사 대상 결제 (카드 + 간편결제) */
  posLive: PosRow[];
  /** 취소로 상쇄된 승인·취소 쌍 (정보) */
  posCancelled: PosRow[];
  /** 대사 대상이 아닌 수단 요약 (현금·계좌이체·기타) */
  posOther: { method: string; n: number; sum: number }[];
  /** 이 날과 얽힌 자국 — 다른 날 판매·다른 날 POS 도 들어 있다 */
  matches: PosMatch[];
  posOpen: (PosRow & { cands: PosOnlyCand[]; note: PosNote | null })[];
  appOpen: (AppItem & { cands: AppOnlyCand[]; note: PosNote | null })[];
  /** 아직 판매에 안 붙은 지난 선결제 — 오늘 판매에 붙일 수 있다 */
  prepaid: PosRow[];
  posTotal: number;
  posCardTotal: number;
  posEasyTotal: number;
  appTotal: number;
  appCardTotal: number;
  appEasyTotal: number;
  /** 미해결 = 남은 돈도 있고 사유도 없는 것 */
  openN: number;
  closed: { at: string; by: number | null } | null;
}

const REF_TABLE: Record<AppKind, string> = { quote: "quote", qp: "quote_payment", rp: "receivable_payment" };
const KIND_OF: Record<string, AppKind> = { quote: "quote", quote_payment: "qp", receivable_payment: "rp" };
export const appKey = (kind: AppKind, id: number) => `${kind}:${id}`;
export function parseAppKey(key: string): { kind: AppKind; id: number } | null {
  const m = /^(quote|qp|rp):(\d+)$/.exec(key);
  return m ? { kind: m[1] as AppKind, id: Number(m[2]) } : null;
}

const won = (n: number) => n.toLocaleString("ko-KR");
export const shiftDay = (day: string, n: number) =>
  new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

const idList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
const strList = (xs: readonly string[]) => sql.join(xs.map((s) => sql`${s}`), sql`, `);

/* ------------------------------------------------------------------ */
/* 읽기                                                                */

type RawPos = {
  id: number;
  at: string;
  paid_at: string;
  day: string;
  method: string;
  card_co: string | null;
  amount: number;
  is_cancel: boolean;
};

const toPos = (r: RawPos): PosRow => ({
  id: Number(r.id),
  at: r.at,
  paidAt: r.paid_at,
  day: r.day,
  method: r.method,
  appMethod: POS_TO_APP[r.method] ?? r.method,
  cardCo: r.card_co,
  amount: Number(r.amount),
  isCancel: !!r.is_cancel,
  linked: 0,
  remain: Number(r.amount),
});

async function posRowsBetween(from: string, to: string): Promise<PosRow[]> {
  const rows = await db.execute<RawPos>(sql`
    SELECT id, to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') at,
           to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') paid_at,
           to_char(day, 'YYYY-MM-DD') AS "day", method, card_co, amount, is_cancel
    FROM pos_txn WHERE is_active AND day >= ${from}::date AND day <= ${to}::date
    ORDER BY paid_at LIMIT 2000
  `);
  return rows.map(toPos);
}

async function posRowsByIds(ids: number[]): Promise<PosRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.execute<RawPos>(sql`
    SELECT id, to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') at,
           to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') paid_at,
           to_char(day, 'YYYY-MM-DD') AS "day", method, card_co, amount, is_cancel
    FROM pos_txn WHERE id IN (${idList(ids)}) LIMIT 500
  `);
  return rows.map(toPos);
}

/** 앱 대사 항목 — 카드 + 간편결제 (단일 판매 · 분할 몫 · 외상 수금) */
export async function appPayItems(from: string, to: string): Promise<AppItem[]> {
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const who = sql`COALESCE(q.supplier_name, c.name, NULLIF(split_part(COALESCE(q.mars_memo, ''), ' ', 2), ''), '손님')`;
  const M = strList(RECON_METHODS);

  const singles = await db.execute<{ id: number; quote_no: string; total: number; who: string; at: string; day: string; pm: string }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total, ${who} who, q.payment_method pm,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at,
           to_char(${D}, 'YYYY-MM-DD') AS "day"
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method IN (${M}) AND q.total_amount > 0
      AND ${D} >= ${from}::date AND ${D} <= ${to}::date
    ORDER BY q.created_at LIMIT 600
  `);
  const splits = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string; day: string; pm: string }>(sql`
    SELECT pm.id, q.id quote_id, q.quote_no, pm.amount, ${who} who, pm.method pm,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at,
           to_char(${D}, 'YYYY-MM-DD') AS "day"
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND pm.method IN (${M}) AND pm.amount > 0
      AND ${D} >= ${from}::date AND ${D} <= ${to}::date
    ORDER BY q.created_at LIMIT 600
  `);
  const colls = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string | null; day: string; pm: string }>(sql`
    SELECT rp.id, q.id quote_id, q.quote_no, rp.amount, ${who} who, rp.method pm,
           to_char(rp.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at,
           to_char(rp.paid_on, 'YYYY-MM-DD') AS "day"
    FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id LEFT JOIN customer c ON c.id = q.customer_id
    WHERE rp.method IN (${M}) AND rp.amount > 0
      AND rp.paid_on >= ${from}::date AND rp.paid_on <= ${to}::date
    ORDER BY rp.id LIMIT 600
  `);
  return [
    ...singles.map((r) => item("quote", Number(r.id), Number(r.id), r, Number(r.total), r.pm)),
    ...splits.map((r) => item("qp", Number(r.id), Number(r.quote_id), r, Number(r.amount), `혼합의 ${r.pm}`)),
    ...colls.map((r) => item("rp", Number(r.id), Number(r.quote_id), r, Number(r.amount), `외상 ${r.pm}수금`)),
  ];
}

function item(
  kind: AppKind,
  refId: number,
  quoteId: number,
  r: { quote_no: string; who: string; at: string | null; day: string; pm: string },
  amount: number,
  tail: string,
): AppItem {
  return {
    key: appKey(kind, refId),
    kind,
    refId,
    quoteId,
    quoteNo: r.quote_no,
    who: r.who,
    amount,
    at: r.at,
    day: r.day,
    method: r.pm,
    pm: tail,
    linked: 0,
    remain: amount,
  };
}

/** 자국이 가리키는 앱 항목을 ref 로 되찾는다 (앞뒤 7일 밖 판매에 붙은 경우) */
async function appItemsByRefs(refs: { table: string; id: number }[]): Promise<AppItem[]> {
  if (refs.length === 0) return [];
  const who = sql`COALESCE(q.supplier_name, c.name, NULLIF(split_part(COALESCE(q.mars_memo, ''), ' ', 2), ''), '손님')`;
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const pick = (t: string) => [...new Set(refs.filter((r) => r.table === t).map((r) => r.id))];
  const out: AppItem[] = [];

  const qIds = pick("quote");
  if (qIds.length > 0) {
    const rows = await db.execute<{ id: number; quote_no: string; total: number; who: string; at: string; day: string; pm: string }>(sql`
      SELECT q.id, q.quote_no, q.total_amount total, ${who} who, q.payment_method pm,
             to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at, to_char(${D}, 'YYYY-MM-DD') AS "day"
      FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
      WHERE q.id IN (${idList(qIds)}) LIMIT 300
    `);
    for (const r of rows) out.push(item("quote", Number(r.id), Number(r.id), r, Number(r.total), r.pm));
  }
  const pIds = pick("quote_payment");
  if (pIds.length > 0) {
    const rows = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string; day: string; pm: string }>(sql`
      SELECT pm.id, q.id quote_id, q.quote_no, pm.amount, ${who} who, pm.method pm,
             to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at, to_char(${D}, 'YYYY-MM-DD') AS "day"
      FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id LEFT JOIN customer c ON c.id = q.customer_id
      WHERE pm.id IN (${idList(pIds)}) LIMIT 300
    `);
    for (const r of rows) out.push(item("qp", Number(r.id), Number(r.quote_id), r, Number(r.amount), `혼합의 ${r.pm}`));
  }
  const rIds = pick("receivable_payment");
  if (rIds.length > 0) {
    const rows = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string | null; day: string; pm: string }>(sql`
      SELECT rp.id, q.id quote_id, q.quote_no, rp.amount, ${who} who, rp.method pm,
             to_char(rp.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at, to_char(rp.paid_on, 'YYYY-MM-DD') AS "day"
      FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id LEFT JOIN customer c ON c.id = q.customer_id
      WHERE rp.id IN (${idList(rIds)}) LIMIT 300
    `);
    for (const r of rows) out.push(item("rp", Number(r.id), Number(r.quote_id), r, Number(r.amount), `외상 ${r.pm}수금`));
  }
  return out;
}

type RawMatch = {
  id: number;
  src_id: number;
  ref_table: string;
  ref_id: number;
  amount: number;
  method: string;
};

/** ref 목록을 (ref_table, ref_id) 조건으로 */
function refConds(items: AppItem[]) {
  return (["quote", "qp", "rp"] as AppKind[])
    .map((kind) => {
      const ids = [...new Set(items.filter((a) => a.kind === kind).map((a) => a.refId))];
      return ids.length === 0 ? null : sql`(ref_table = ${REF_TABLE[kind]} AND ref_id IN (${idList(ids)}))`;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}

/** 승인·취소 상쇄 쌍을 걸러 「살아 있는 결제」만 — 카드도 간편결제도 (2026-08-29) */
function liveReconRows(rows: PosRow[]): { live: PosRow[]; cancelled: PosRow[] } {
  const target = rows.filter((r) => isReconPos(r.method));
  const cancels = target.filter((r) => r.isCancel || r.amount < 0);
  const used = new Set<number>();
  const cancelled: PosRow[] = [];
  for (const cx of cancels) {
    const orig = target.find(
      (r) =>
        !used.has(r.id) &&
        !r.isCancel &&
        r.amount === -cx.amount &&
        r.method === cx.method &&
        r.cardCo === cx.cardCo &&
        r.paidAt <= cx.paidAt,
    );
    if (orig) {
      used.add(orig.id);
      cancelled.push(orig, cx);
    } else cancelled.push(cx);
    used.add(cx.id);
  }
  return { live: target.filter((r) => !used.has(r.id) && r.amount > 0), cancelled };
}

/** 합이 target 이 되는 조합(2~3개)을 모두 찾는다 — 답이 하나일 때만 자동으로 쓴다 */
function combosSummingTo<T extends { remain: number }>(items: T[], target: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].remain + items[j].remain === target) out.push([items[i], items[j]]);
      for (let k = j + 1; k < n; k++) {
        if (items[i].remain + items[j].remain + items[k].remain === target) out.push([items[i], items[j], items[k]]);
      }
    }
    if (out.length > 8) return out; // 너무 많으면 어차피 애매하다 — 그만 센다
  }
  return out;
}

export async function posDayData(day: string): Promise<PosDayData> {
  const from = shiftDay(day, -NEARBY_DAYS);
  const to = shiftDay(day, NEARBY_DAYS);

  // ① 앞뒤 7일치 POS·앱을 한 번에 (후보 찾기까지 이 안에서 끝난다)
  const posAll = await posRowsBetween(from, to);
  const appAll = await appPayItems(from, to);
  const dayPos = posAll.filter((p) => p.day === day);
  const live = liveReconRows(dayPos).live;
  const cancelled = liveReconRows(dayPos).cancelled;
  const liveNear = liveReconRows(posAll).live;

  // ② 자국 — POS 쪽 + 앱 쪽 양쪽에서 긁는다 (다른 날 POS 가 붙은 것도 잡힌다)
  const nearIds = liveNear.map((r) => r.id);
  const byPos =
    nearIds.length === 0
      ? []
      : await db.execute<RawMatch>(sql`
          SELECT id, src_id, ref_table, ref_id, amount, method FROM recon_match
          WHERE kind = '포스결제' AND status = '확정' AND src_table = 'pos_txn'
            AND src_id IN (${idList(nearIds)}) LIMIT 3000
        `);
  const conds = refConds(appAll);
  const byRef =
    conds.length === 0
      ? []
      : await db.execute<RawMatch>(sql`
          SELECT id, src_id, ref_table, ref_id, amount, method FROM recon_match
          WHERE kind = '포스결제' AND status = '확정' AND src_table = 'pos_txn'
            AND (${sql.join(conds, sql` OR `)}) LIMIT 3000
        `);
  const rawMatches = new Map<number, RawMatch>();
  for (const m of [...byPos, ...byRef]) rawMatches.set(Number(m.id), m);

  // ③ 자국이 가리키는데 앞뒤 7일 밖인 것들을 마저 데려온다
  const posById = new Map(posAll.map((p) => [p.id, p]));
  const appByKey = new Map(appAll.map((a) => [a.key, a]));
  const missPos = [...new Set([...rawMatches.values()].map((m) => Number(m.src_id)))].filter((id) => !posById.has(id));
  for (const p of await posRowsByIds(missPos)) posById.set(p.id, p);
  const missRefs = [...rawMatches.values()]
    .filter((m) => !appByKey.has(appKey(KIND_OF[m.ref_table] ?? "quote", Number(m.ref_id))))
    .map((m) => ({ table: m.ref_table, id: Number(m.ref_id) }));
  for (const a of await appItemsByRefs(missRefs)) appByKey.set(a.key, a);

  // ④ 「붙은 돈」 세기 — 자국을 통째로 훑어야 다른 날에 붙은 몫까지 잡힌다
  const allPosIds = [...posById.keys()];
  const linkedPos =
    allPosIds.length === 0
      ? []
      : await db.execute<{ src_id: number; s: string }>(sql`
          SELECT src_id, COALESCE(SUM(amount), 0)::bigint s FROM recon_match
          WHERE kind = '포스결제' AND status = '확정' AND src_table = 'pos_txn'
            AND src_id IN (${idList(allPosIds)}) GROUP BY 1 LIMIT 3000
        `);
  const linkedPosMap = new Map(linkedPos.map((r) => [Number(r.src_id), Number(r.s)]));
  for (const p of posById.values()) {
    p.linked = linkedPosMap.get(p.id) ?? 0;
    p.remain = p.amount - p.linked;
  }
  const conds2 = refConds([...appByKey.values()]);
  const linkedRef =
    conds2.length === 0
      ? []
      : await db.execute<{ ref_table: string; ref_id: number; s: string }>(sql`
          SELECT ref_table, ref_id, COALESCE(SUM(amount), 0)::bigint s FROM recon_match
          WHERE kind = '포스결제' AND status = '확정' AND (${sql.join(conds2, sql` OR `)})
          GROUP BY 1, 2 LIMIT 3000
        `);
  const linkedRefMap = new Map(
    linkedRef.map((r) => [appKey(KIND_OF[r.ref_table] ?? "quote", Number(r.ref_id)), Number(r.s)]),
  );
  for (const a of appByKey.values()) {
    a.linked = linkedRefMap.get(a.key) ?? 0;
    a.remain = a.amount - a.linked;
  }

  // ⑤ 자국을 화면용으로
  const matches: PosMatch[] = [];
  for (const m of rawMatches.values()) {
    const p = posById.get(Number(m.src_id));
    const a = appByKey.get(appKey(KIND_OF[m.ref_table] ?? "quote", Number(m.ref_id)));
    if (p && a) matches.push({ id: Number(m.id), pos: p, app: a, amount: Number(m.amount), method: m.method });
  }
  matches.sort((x, y) => (x.pos.paidAt < y.pos.paidAt ? -1 : 1));

  // ⑥ 사유
  const notes = await db.execute<{ id: number; kind: "pos_only" | "app_only"; ref: string; reason: string; memo: string | null }>(sql`
    SELECT id, kind, ref, reason, memo FROM pos_note WHERE day >= ${from}::date AND day <= ${to}::date LIMIT 500
  `);
  const noteByRef = new Map(notes.map((n) => [n.ref, { ...n, id: Number(n.id) }]));

  // ⑦ 남은 것 + 한 번 누르기 후보
  const dayApp = [...appByKey.values()].filter((a) => a.day === day);
  const openPos = live.filter((p) => p.remain !== 0);
  const openApp = dayApp.filter((a) => a.remain !== 0);
  const nearPosFree = liveNear.filter(
    (p) => p.remain > 0 && (!noteByRef.has(`pos:${p.id}`) || noteByRef.get(`pos:${p.id}`)?.reason === PREPAID_REASON),
  );
  const nearAppFree = [...appByKey.values()].filter((a) => a.remain > 0 && a.day >= from && a.day <= to);

  // 수단 착오 후보 — 그 날 판매 중 금액은 같은데 수단이 다른 것
  const sameDaySales = await db.execute<{ id: number; quote_no: string; total: number; pm: string | null; who: string }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total, q.payment_method pm,
           COALESCE(q.supplier_name, c.name, '손님') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) = ${day}::date
      AND q.payment_method IN ('현금', '계좌이체', '외상', '지역화폐', '카드', '간편결제')
    LIMIT 400
  `);

  const dayGap = (d: string) =>
    Math.round((new Date(d + "T00:00:00Z").getTime() - new Date(day + "T00:00:00Z").getTime()) / 86400000);
  const gapLabel = (d: string) => {
    const g = dayGap(d);
    return g === 0 ? "" : g < 0 ? ` (${-g}일 전)` : ` (${g}일 뒤)`;
  };

  const posOpen = openPos.map((p) => {
    const cands: PosOnlyCand[] = [];
    // ① 수단 착오 — 금액이 같은데 앱엔 다른 수단으로 적힌 판매
    for (const q of sameDaySales) {
      if (Number(q.total) !== p.remain || q.pm === p.appMethod) continue;
      cands.push({
        kind: "fixMethod",
        quoteId: Number(q.id),
        toMethod: p.appMethod,
        label: `${q.quote_no} · ${q.who} · ${won(Number(q.total))}원 · 앱엔 ${q.pm}`,
      });
    }
    /* ② 다른 날 판매에 붙이기 — 미리 받은 돈·나중에 받은 돈은 날짜를 옮기지 않는다.
       🔴 **금액이 딱 맞을 때만** 띄운다. POS 자료가 없는 지난 날의 판매는 통째로 「남은 돈」이라
          「더 큰 판매에 부어 넣기」를 허용하면 그 판매 하나가 모든 POS 건의 후보로 뜬다
          (실측 2026-08-28: 8/21 판매 946,000원이 6건 전부의 첫 후보로 올라왔다).
          금액이 안 맞는 경우는 아래 「앱 판매 골라서 붙이기」로 손수 고르시면 된다. */
    for (const a of nearAppFree) {
      if (a.day === day || a.remain !== p.remain) continue;
      cands.push({
        kind: "linkApp",
        appKey: a.key,
        amount: p.remain,
        exact: true,
        label: `${a.quoteNo} · ${a.who} · ${won(a.remain)}원 남음${gapLabel(a.day)}`,
      });
    }
    // ③ 진짜 날짜 착오 — 앞뒤 1일의 단일 판매만 (옮기는 것은 되돌리기 번거롭다)
    for (const a of nearAppFree) {
      if (a.kind !== "quote" || Math.abs(dayGap(a.day)) !== 1 || a.remain !== p.remain) continue;
      cands.push({
        kind: "moveDate",
        quoteId: a.quoteId,
        fromDay: a.day,
        label: `${a.quoteNo} · ${a.who} · ${won(a.amount)}원 (${a.day.slice(5)} 판매)`,
      });
    }
    return { ...p, cands: cands.slice(0, 5), note: noteByRef.get(`pos:${p.id}`) ?? null };
  });

  const appOpen = openApp.map((a) => {
    const cands: AppOnlyCand[] = [];
    // ① 한 건으로 딱 맞는 것
    for (const p of nearPosFree) {
      if (p.remain !== a.remain) continue;
      cands.push({
        kind: "linkPos",
        posId: p.id,
        day: p.day,
        amount: p.remain,
        exact: true,
        label: `${p.paidAt.slice(5, 16)} · ${p.cardCo ?? p.appMethod} · ${won(p.remain)}원${gapLabel(p.day)}`,
      });
    }
    // ② 여러 건을 합치면 맞는 것 (2~3건) — 같은 날 것만 (다른 날까지 섞으면 우연이 늘어난다)
    const sameDayFree = nearPosFree.filter((p) => p.day === day);
    if (cands.length === 0 && sameDayFree.length <= 24) {
      for (const combo of combosSummingTo(sameDayFree, a.remain).slice(0, 2)) {
        cands.push({
          kind: "linkPosMulti",
          posIds: combo.map((p) => p.id),
          amount: a.remain,
          label: combo.map((p) => `${p.at.slice(0, 5)} ${p.cardCo ?? p.appMethod} ${won(p.remain)}원`).join(" + "),
        });
      }
    }
    /* ③ 일부만 채우는 것 (부분 결제) — 같은 날 것만.
       다른 날 것까지 띄우면 남의 판매에 갈 돈이 후보로 올라온다 (실측 8/26 홍동식 ← 8/28 신한 66,000) */
    const exactCands = cands.length; // ①② 로 잡힌 확실한 후보 수 — ④ 판단에 쓴다
    const partialPool = exactCands === 0
      ? [...sameDayFree].sort((x, y) => Number(y.appMethod === a.method) - Number(x.appMethod === a.method))
      : [];
    for (const p of partialPool) {
      if (cands.length >= 4) break;
      if (p.remain >= a.remain || p.remain <= 0) continue;
      cands.push({
        kind: "linkPos",
        posId: p.id,
        day: p.day,
        amount: p.remain,
        exact: false,
        label: `${p.paidAt.slice(5, 16)} · ${p.cardCo ?? p.appMethod} · ${won(p.remain)}원만${gapLabel(p.day)}`,
      });
    }
    /* ④ ⭐ 수단 착오 — 앱엔 「카드」인데 채울 POS 가 전부 「간편결제」다 (사장님 제보 2026-08-29).
       고치면 수단이 같아져 ②의 묶음까지 **자동으로** 붙는다. 그래서 이 단추를 맨 앞에 둔다. */
    const fillers = cands
      .slice(0, exactCands === 0 ? cands.length : exactCands)
      .flatMap((c) => (c.kind === "linkPos" ? [c.posId] : c.kind === "linkPosMulti" ? c.posIds : []));
    const fillMethods = [...new Set(fillers.map((id) => nearPosFree.find((p) => p.id === id)?.appMethod).filter(Boolean))];
    if (a.kind === "quote" && fillMethods.length === 1 && fillMethods[0] !== a.method) {
      cands.unshift({
        kind: "fixSelfMethod",
        quoteId: a.quoteId,
        toMethod: fillMethods[0]!,
        label: `앱엔 ${a.method}로 적혔는데 단말기는 ${fillMethods[0]}입니다`,
      });
    }
    return { ...a, cands: cands.slice(0, 4), note: noteByRef.get(a.key) ?? null };
  });

  /* ⑧ 아직 판매에 안 붙은 지난 선결제 — 60일까지 거슬러 본다.
     판매가 생길 때까지 화면에 계속 떠서 「남은 돈」에 붙일 수 있다 */
  const prepaidNotes = await db.execute<{ ref: string }>(sql`
    SELECT ref FROM pos_note
    WHERE reason = ${PREPAID_REASON} AND ref LIKE 'pos:%'
      AND day >= ${shiftDay(day, -60)}::date AND day < ${day}::date LIMIT 200
  `);
  const prepaidIds = prepaidNotes.map((r) => Number(r.ref.slice(4))).filter((n) => Number.isFinite(n));
  const missing = prepaidIds.filter((id) => !posById.has(id));
  if (missing.length > 0) {
    const rows = await posRowsByIds(missing);
    const linked = await db.execute<{ src_id: number; s: string }>(sql`
      SELECT src_id, COALESCE(SUM(amount), 0)::bigint s FROM recon_match
      WHERE kind = '포스결제' AND status = '확정' AND src_table = 'pos_txn'
        AND src_id IN (${idList(missing)}) GROUP BY 1 LIMIT 300
    `);
    const lm = new Map(linked.map((r) => [Number(r.src_id), Number(r.s)]));
    for (const p of rows) {
      p.linked = lm.get(p.id) ?? 0;
      p.remain = p.amount - p.linked;
      posById.set(p.id, p);
    }
  }
  const prepaid = prepaidIds
    .map((id) => posById.get(id))
    .filter((p): p is PosRow => !!p && p.remain > 0 && p.day !== day);

  const otherMap = new Map<string, { n: number; sum: number }>();
  for (const r of dayPos.filter((x) => !isReconPos(x.method))) {
    const o = otherMap.get(r.method) ?? { n: 0, sum: 0 };
    o.n++;
    o.sum += r.amount;
    otherMap.set(r.method, o);
  }

  const [cl] = await db.execute<{ at: string; by: number | null }>(sql`
    SELECT to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, closed_by by
    FROM pos_close WHERE day = ${day}::date
  `);

  return {
    day,
    hasPos: dayPos.length > 0,
    posLive: live,
    posCancelled: cancelled,
    posOther: [...otherMap].map(([method, o]) => ({ method, ...o })),
    matches: matches.filter((m) => m.pos.day === day || m.app.day === day),
    posOpen,
    appOpen,
    prepaid,
    posTotal: live.reduce((s, r) => s + r.amount, 0),
    posCardTotal: live.filter((r) => r.appMethod === "카드").reduce((s, r) => s + r.amount, 0),
    posEasyTotal: live.filter((r) => r.appMethod === "간편결제").reduce((s, r) => s + r.amount, 0),
    appTotal: dayApp.reduce((s, a) => s + a.amount, 0),
    appCardTotal: dayApp.filter((a) => a.method === "카드").reduce((s, a) => s + a.amount, 0),
    appEasyTotal: dayApp.filter((a) => a.method === "간편결제").reduce((s, a) => s + a.amount, 0),
    openN: posOpen.filter((p) => !p.note).length + appOpen.filter((a) => !a.note).length,
    closed: cl ? { at: cl.at, by: cl.by === null ? null : Number(cl.by) } : null,
  };
}

/* ------------------------------------------------------------------ */
/* 쓰기                                                                */

/** 자국 한 줄 — 없으면 넣고 이미 있으면 둔다 (짝 단위 유니크) */
export async function insertMatch(
  posId: number,
  kind: AppKind,
  refId: number,
  amount: number,
  method: string,
  uid: number | null,
): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
    VALUES ('포스결제', 'pos_txn', ${posId}, ${REF_TABLE[kind]}, ${refId}, ${amount}, '확정', ${method}, ${uid}, now())
    ON CONFLICT (src_table, src_id, ref_table, ref_id) WHERE kind = '포스결제' DO NOTHING
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * 자동 대조 (쓰기, 멱등) — 3단으로 확실한 것부터.
 *   ① POS 1건 = 앱 1건, 수단도 금액도 같음
 *   ② POS 여러 건(2~3)의 합 = 앱 1건 — 카드 두 장으로 나눠 긁은 경우
 *   ③ POS 1건 = 앱 여러 건(2~3)의 합 — 한 번 긁어 두 건 치른 경우
 * 🔴 답이 둘 이상 나오면 붙이지 않는다. 모르는 채 붙이면 나중에 못 푼다.
 * 🔴 수단이 다르면 자동으로 안 붙인다 — 화면에 「고치기」 후보로만 띄운다.
 * 🔴 사유가 달린 것은 건드리지 않는다 (선결제는 예외 — 판매가 나타나면 붙는다).
 */
export async function autoMatchPosDayCore(day: string, uid: number | null): Promise<number> {
  const data = await posDayData(day);
  const usable = (note: PosNote | null) => !note || note.reason === PREPAID_REASON;
  const posC = data.posOpen.filter((p) => usable(p.note) && p.remain > 0).map((p) => ({ ...p }));
  const appC = data.appOpen.filter((a) => usable(a.note) && a.remain > 0).map((a) => ({ ...a }));
  const links: { posId: number; app: AppItem; amount: number }[] = [];
  const take = (p: { id: number; remain: number }, a: AppItem, amount: number) => {
    p.remain -= amount;
    a.remain -= amount;
    links.push({ posId: p.id, app: a, amount });
  };

  // ① 1:1 — 같은 수단·같은 금액. 여럿이면 시각 순서로 짝
  const byAmt = new Map<string, { pos: typeof posC; app: typeof appC }>();
  for (const p of posC) {
    const k = `${p.appMethod}|${p.remain}`;
    const g = byAmt.get(k) ?? { pos: [], app: [] };
    g.pos.push(p);
    byAmt.set(k, g);
  }
  for (const a of appC) {
    const g = byAmt.get(`${a.method}|${a.remain}`);
    if (g) g.app.push(a);
  }
  for (const g of byAmt.values()) {
    g.pos.sort((x, y) => (x.paidAt < y.paidAt ? -1 : 1));
    g.app.sort((x, y) => ((x.at ?? "") < (y.at ?? "") ? -1 : 1));
    const k = Math.min(g.pos.length, g.app.length);
    for (let i = 0; i < k; i++) {
      if (g.pos[i].remain <= 0 || g.app[i].remain <= 0) continue;
      take(g.pos[i], g.app[i], g.pos[i].remain);
    }
  }

  /* ②③ 묶음 — 미배정이 많으면 조합이 폭발하고 오답 위험이 커진다. 12건 넘으면 안 돌린다 */
  const restPos = () => posC.filter((p) => p.remain > 0);
  const restApp = () => appC.filter((a) => a.remain > 0);
  if (restPos().length <= 12 && restApp().length <= 12) {
    for (const a of restApp()) {
      const combos = combosSummingTo(restPos().filter((p) => p.appMethod === a.method), a.remain);
      if (combos.length !== 1) continue;
      for (const p of combos[0]) take(p, a, p.remain);
    }
    for (const p of restPos()) {
      const combos = combosSummingTo(restApp().filter((a) => a.method === p.appMethod), p.remain);
      if (combos.length !== 1) continue;
      for (const a of combos[0]) take(p, a, a.remain);
    }
  }

  let n = 0;
  for (const l of links) {
    if (await insertMatch(l.posId, l.app.kind, l.app.refId, l.amount, "자동", uid)) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ */

/** 달의 날짜별 요약 — 카드 화면 표·현황·마감 체크리스트 */
export interface PosDaySummary {
  day: string;
  posCard: number;
  appCard: number;
  matched: number;
  open: number;
  closed: boolean;
}

/**
 * 🔴 여기서 posDayData 를 날마다 부르면 안 된다 — 한 날에 질의가 열 번 넘게 나가서
 *    현황 화면이 한 달치를 도느라 멈춘다. 같은 셈을 집계 SQL 로 한 번에 한다.
 *    「남은 건수」는 일마감 화면과 같은 규칙 — 붙은 돈이 모자라고 사유도 없는 것.
 */
export async function posDaysSummary(ym: string): Promise<PosDaySummary[]> {
  const start = sql`(${ym + "-01"})::date`;
  const nextStart = sql`((${ym + "-01"})::date + interval '1 month')`;
  const M = strList(RECON_METHODS);
  /** 자국이 붙은 금액 */
  const linkedPos = sql`(SELECT COALESCE(SUM(rm.amount), 0) FROM recon_match rm
    WHERE rm.kind = '포스결제' AND rm.status = '확정' AND rm.src_table = 'pos_txn' AND rm.src_id = l.id)`;

  // ① POS 쪽 — 취소로 상쇄된 승인은 뺀다 (liveReconRows 와 같은 규칙)
  const posRows = await db.execute<{ day: string; s: string; open: number; matched: number }>(sql`
    WITH l AS (
      SELECT p.id, p.day, p.amount FROM pos_txn p
      WHERE p.is_active AND p.day >= ${start} AND p.day < ${nextStart}
        AND p.method IN (${strList(RECON_POS_METHODS)}) AND p.amount > 0 AND NOT p.is_cancel
        AND NOT EXISTS (
          SELECT 1 FROM pos_txn c WHERE c.is_active AND c.day = p.day AND c.is_cancel
            AND c.method = p.method AND c.card_co IS NOT DISTINCT FROM p.card_co
            AND c.amount = -p.amount AND c.paid_at >= p.paid_at
        )
    )
    SELECT to_char(l.day, 'YYYY-MM-DD') AS "day", COALESCE(SUM(l.amount), 0)::bigint s,
           count(*) FILTER (WHERE ${linkedPos} < l.amount
             AND NOT EXISTS (SELECT 1 FROM pos_note n WHERE n.ref = 'pos:' || l.id))::int open,
           count(*) FILTER (WHERE ${linkedPos} >= l.amount)::int matched
    FROM l GROUP BY 1 ORDER BY 1 LIMIT 40
  `);

  // ② 앱 쪽 — 단일 판매 · 분할 몫 · 외상 수금을 한 줄기로
  const linkedRef = sql`(SELECT COALESCE(SUM(rm.amount), 0) FROM recon_match rm
    WHERE rm.kind = '포스결제' AND rm.status = '확정' AND rm.ref_table = a.t AND rm.ref_id = a.rid)`;
  const appRows = await db.execute<{ day: string; s: string; open: number }>(sql`
    WITH a AS (
      SELECT 'quote' t, q.id rid, 'quote:' || q.id ref, q.total_amount amt,
             COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) d
      FROM quote q
      WHERE q.status = '성사' AND q.payment_method IN (${M}) AND q.total_amount > 0
        AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}
        AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}
      UNION ALL
      SELECT 'quote_payment', pm.id, 'qp:' || pm.id, pm.amount,
             COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)
      FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id
      WHERE q.status = '성사' AND pm.method IN (${M}) AND pm.amount > 0
        AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}
        AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}
      UNION ALL
      SELECT 'receivable_payment', rp.id, 'rp:' || rp.id, rp.amount, rp.paid_on
      FROM receivable_payment rp
      WHERE rp.method IN (${M}) AND rp.amount > 0
        AND rp.paid_on >= ${start} AND rp.paid_on < ${nextStart}
    )
    SELECT to_char(a.d, 'YYYY-MM-DD') AS "day", COALESCE(SUM(a.amt), 0)::bigint s,
           count(*) FILTER (WHERE ${linkedRef} < a.amt
             AND NOT EXISTS (SELECT 1 FROM pos_note n WHERE n.ref = a.ref))::int open
    FROM a GROUP BY 1 ORDER BY 1 LIMIT 40
  `);

  const closed = await db.execute<{ day: string }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS "day" FROM pos_close WHERE to_char(day, 'YYYY-MM') = ${ym} LIMIT 40
  `);
  const closedSet = new Set(closed.map((c) => c.day));
  const appMap = new Map(appRows.map((r) => [r.day, r]));

  // POS 자료가 있는 날만 — 앱만 있는 날은 「일마감할 날」이 아니다 (전과 같음)
  return posRows.map((r) => {
    const a = appMap.get(r.day);
    return {
      day: r.day,
      posCard: Number(r.s),
      appCard: Number(a?.s ?? 0),
      matched: Number(r.matched),
      open: Number(r.open) + Number(a?.open ?? 0),
      closed: closedSet.has(r.day),
    };
  });
}
