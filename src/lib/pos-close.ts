/**
 * ⭐ 카드매출 일마감 — 토스 포스 결제 건 ↔ 앱 판매 대조 정본 (사장님 요청 2026-08-26)
 *
 *   "매일 매출리포트를 내려받아 앱 판매내역과 자동 대조하며 카드매출을 일마감하고 싶다."
 *   정본 = POS 결제 건(실제로 긁힌 돈). 앱 판매는 그에 맞춰 고친다(수단 착오·미등록·날짜 착오).
 *
 *   앱 쪽 카드 항목 = quote 단일카드(총액) + quote_payment 카드 분할 + receivable_payment 카드 수금.
 *   자국 = recon_match kind '포스결제' (src pos_txn → ref quote | quote_payment | receivable_payment).
 *   자동 대조 = 같은 금액끼리, 같은 금액이 여럿이면 시각 순서로 짝. 남는 것은 사람 몫 —
 *   각 카드에 버튼 하나(카드로 고치기 / 날짜 옮기기 / 정비내역 등록 / 단말기 누락 표시).
 *
 * 🔴 "use server" 아님 — 페이지·액션·ingest 가 부른다. 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface PosRow {
  id: number;
  /** HH:MM:SS */
  at: string;
  paidAt: string;
  method: string;
  cardCo: string | null;
  amount: number;
  isCancel: boolean;
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
  /** 앱에 적힌 수단 — 단일카드 '카드', 분할 '혼합', 외상 카드 수금 '외상' */
  pm: string;
}

export interface PosNote {
  id: number;
  kind: "pos_only" | "app_only";
  ref: string;
  reason: string;
  memo: string | null;
}

export interface PosOnlyCand {
  kind: "fixMethod" | "moveDate";
  quoteId: number;
  label: string;
  /** moveDate 만 — 그 판매의 현재 날짜 */
  fromDay?: string;
}

export interface AppOnlyCand {
  kind: "linkPos";
  posId: number;
  label: string;
  day: string;
}

export interface PosPair {
  pos: PosRow;
  app: AppItem;
  method: string;
}

export interface PosDayData {
  day: string;
  hasPos: boolean;
  posCard: PosRow[];
  /** 취소로 상쇄된 승인·취소 쌍 (정보) */
  posCancelled: PosRow[];
  posOther: { method: string; n: number; sum: number }[];
  pairs: PosPair[];
  posOnly: (PosRow & { cands: PosOnlyCand[]; note: PosNote | null })[];
  appOnly: (AppItem & { cands: AppOnlyCand[]; note: PosNote | null })[];
  posCardTotal: number;
  appCardTotal: number;
  /** 미해결 = 짝도 사유도 없는 것 */
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

async function posRowsOf(day: string): Promise<PosRow[]> {
  const rows = await db.execute<{
    id: number; at: string; paid_at: string; method: string; card_co: string | null; amount: number; is_cancel: boolean;
  }>(sql`
    SELECT id, to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') at,
           to_char(paid_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') paid_at,
           method, card_co, amount, is_cancel
    FROM pos_txn WHERE is_active AND day = ${day}::date ORDER BY paid_at LIMIT 500
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    at: r.at,
    paidAt: r.paid_at,
    method: r.method,
    cardCo: r.card_co,
    amount: Number(r.amount),
    isCancel: !!r.is_cancel,
  }));
}

/** 앱 카드 항목 — 그 날 */
export async function appCardItems(day: string): Promise<AppItem[]> {
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const who = sql`COALESCE(q.supplier_name, c.name, NULLIF(split_part(COALESCE(q.mars_memo, ''), ' ', 2), ''), '손님')`;
  const singles = await db.execute<{ id: number; quote_no: string; total: number; who: string; at: string }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total, ${who} who,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method = '카드' AND q.total_amount > 0 AND ${D} = ${day}::date
    ORDER BY q.created_at LIMIT 300
  `);
  const splits = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string }>(sql`
    SELECT pm.id, q.id quote_id, q.quote_no, pm.amount, ${who} who,
           to_char(q.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND pm.method = '카드' AND pm.amount > 0 AND ${D} = ${day}::date
    ORDER BY q.created_at LIMIT 300
  `);
  const colls = await db.execute<{ id: number; quote_id: number; quote_no: string; amount: number; who: string; at: string | null }>(sql`
    SELECT rp.id, q.id quote_id, q.quote_no, rp.amount, ${who} who,
           to_char(rp.created_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') at
    FROM receivable_payment rp JOIN quote q ON q.id = rp.quote_id LEFT JOIN customer c ON c.id = q.customer_id
    WHERE rp.method = '카드' AND rp.amount > 0 AND rp.paid_on = ${day}::date
    ORDER BY rp.id LIMIT 300
  `);
  return [
    ...singles.map((r) => ({ key: appKey("quote", Number(r.id)), kind: "quote" as const, refId: Number(r.id), quoteId: Number(r.id), quoteNo: r.quote_no, who: r.who, amount: Number(r.total), at: r.at, pm: "카드" })),
    ...splits.map((r) => ({ key: appKey("qp", Number(r.id)), kind: "qp" as const, refId: Number(r.id), quoteId: Number(r.quote_id), quoteNo: r.quote_no, who: r.who, amount: Number(r.amount), at: r.at, pm: "혼합" })),
    ...colls.map((r) => ({ key: appKey("rp", Number(r.id)), kind: "rp" as const, refId: Number(r.id), quoteId: Number(r.quote_id), quoteNo: r.quote_no, who: r.who, amount: Number(r.amount), at: r.at, pm: "외상 카드수금" })),
  ];
}

async function matchesOf(posIds: number[]): Promise<Map<number, { table: string; id: number; method: string }>> {
  if (posIds.length === 0) return new Map();
  const rows = await db.execute<{ src_id: number; ref_table: string; ref_id: number; method: string }>(sql`
    SELECT src_id, ref_table, ref_id, method FROM recon_match
    WHERE kind = '포스결제' AND src_table = 'pos_txn' AND status = '확정'
      AND src_id IN (${sql.join(posIds.map((i) => sql`${i}`), sql`, `)})
    LIMIT 1000
  `);
  return new Map(rows.map((r) => [Number(r.src_id), { table: r.ref_table, id: Number(r.ref_id), method: r.method }]));
}

/** 승인·취소 상쇄 쌍을 걸러 「살아 있는 카드 결제」만 */
function liveCardRows(rows: PosRow[]): { live: PosRow[]; cancelled: PosRow[] } {
  const card = rows.filter((r) => r.method === "카드");
  const cancels = card.filter((r) => r.isCancel || r.amount < 0);
  const used = new Set<number>();
  const cancelled: PosRow[] = [];
  for (const cx of cancels) {
    const orig = card.find((r) => !used.has(r.id) && !r.isCancel && r.amount === -cx.amount && r.cardCo === cx.cardCo && r.paidAt <= cx.paidAt);
    if (orig) {
      used.add(orig.id);
      cancelled.push(orig, cx);
    } else cancelled.push(cx);
    used.add(cx.id);
  }
  return { live: card.filter((r) => !used.has(r.id) && r.amount > 0), cancelled };
}

const shiftDay = (day: string, n: number) => new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

export async function posDayData(day: string): Promise<PosDayData> {
  const rows = await posRowsOf(day);
  const { live, cancelled } = liveCardRows(rows);
  const otherMap = new Map<string, { n: number; sum: number }>();
  for (const r of rows.filter((x) => x.method !== "카드")) {
    const o = otherMap.get(r.method) ?? { n: 0, sum: 0 };
    o.n++;
    o.sum += r.amount;
    otherMap.set(r.method, o);
  }
  const app = await appCardItems(day);
  const matches = await matchesOf(live.map((r) => r.id));
  const appByKey = new Map(app.map((a) => [a.key, a]));
  const pairs: PosPair[] = [];
  const pairedApp = new Set<string>();
  const posOnlyRows: PosRow[] = [];
  for (const p of live) {
    const m = matches.get(p.id);
    if (m) {
      const k = appKey(KIND_OF[m.table] ?? "quote", m.id);
      const a = appByKey.get(k);
      if (a) {
        pairs.push({ pos: p, app: a, method: m.method });
        pairedApp.add(k);
        continue;
      }
    }
    posOnlyRows.push(p);
  }
  const appOnlyItems = app.filter((a) => !pairedApp.has(a.key));

  const notes = await db.execute<{ id: number; kind: "pos_only" | "app_only"; ref: string; reason: string; memo: string | null }>(sql`
    SELECT id, kind, ref, reason, memo FROM pos_note WHERE day = ${day}::date LIMIT 200
  `);
  const noteByRef = new Map(notes.map((n) => [n.ref, { ...n, id: Number(n.id) }]));

  // posOnly 후보: 같은 날 같은 금액의 비카드 판매(수단 착오) · 전날/다음날 앱 카드 항목(날짜 착오)
  const nonCard = await db.execute<{ id: number; quote_no: string; total: number; pm: string | null; who: string }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total, q.payment_method pm,
           COALESCE(q.supplier_name, c.name, '손님') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) = ${day}::date
      AND q.payment_method IN ('현금', '계좌이체', '외상', '지역화폐')
    LIMIT 300
  `);
  const prevApp = posOnlyRows.length > 0 ? await appCardItems(shiftDay(day, -1)) : [];
  const nextApp = posOnlyRows.length > 0 ? await appCardItems(shiftDay(day, 1)) : [];
  const adjApp = [...prevApp.map((a) => ({ a, d: shiftDay(day, -1) })), ...nextApp.map((a) => ({ a, d: shiftDay(day, 1) }))];
  const adjMatched = await matchesOf([]); // (앱 항목 쪽 자국은 아래 posMatchedApp 으로)
  void adjMatched;
  const matchedAppKeys = await db.execute<{ ref_table: string; ref_id: number }>(sql`
    SELECT ref_table, ref_id FROM recon_match WHERE kind = '포스결제' AND status = '확정'
      AND src_id IN (SELECT id FROM pos_txn WHERE is_active AND day BETWEEN ${shiftDay(day, -1)}::date AND ${shiftDay(day, 1)}::date)
    LIMIT 2000
  `);
  const matchedKeySet = new Set(matchedAppKeys.map((r) => appKey(KIND_OF[r.ref_table] ?? "quote", Number(r.ref_id))));

  const posOnly = posOnlyRows.map((p) => {
    const cands: PosOnlyCand[] = [];
    for (const q of nonCard) {
      if (Number(q.total) === p.amount) cands.push({ kind: "fixMethod", quoteId: Number(q.id), label: `${q.quote_no} · ${q.who} · ${won(Number(q.total))}원 · 앱엔 ${q.pm}` });
    }
    for (const { a, d } of adjApp) {
      if (a.amount === p.amount && !matchedKeySet.has(a.key) && a.kind === "quote")
        cands.push({ kind: "moveDate", quoteId: a.quoteId, label: `${a.quoteNo} · ${a.who} · ${won(a.amount)}원 (${d.slice(5)} 판매)`, fromDay: d });
    }
    return { ...p, cands: cands.slice(0, 4), note: noteByRef.get(`pos:${p.id}`) ?? null };
  });

  // appOnly 후보: 전날/다음날 POS 미배정 건에 같은 금액
  const adjPos = appOnlyItems.length > 0 ? [...(await posRowsOf(shiftDay(day, -1))), ...(await posRowsOf(shiftDay(day, 1)))] : [];
  const adjLive = liveCardRows(adjPos).live;
  const adjPosMatched = await matchesOf(adjLive.map((r) => r.id));
  const appOnly = appOnlyItems.map((a) => {
    const cands: AppOnlyCand[] = adjLive
      .filter((p) => p.amount === a.amount && !adjPosMatched.has(p.id))
      .slice(0, 3)
      .map((p) => ({ kind: "linkPos" as const, posId: p.id, day: p.paidAt.slice(0, 10), label: `${p.paidAt.slice(5, 16)} · ${p.cardCo ?? ""} · ${won(p.amount)}원` }));
    return { ...a, cands, note: noteByRef.get(a.key) ?? null };
  });

  const [cl] = await db.execute<{ at: string; by: number | null }>(sql`
    SELECT to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, closed_by by FROM pos_close WHERE day = ${day}::date
  `);
  const posCardTotal = live.reduce((s, r) => s + r.amount, 0);
  const appCardTotal = app.reduce((s, a) => s + a.amount, 0);
  return {
    day,
    hasPos: rows.length > 0,
    posCard: live,
    posCancelled: cancelled,
    posOther: [...otherMap].map(([method, o]) => ({ method, ...o })),
    pairs,
    posOnly,
    appOnly,
    posCardTotal,
    appCardTotal,
    openN: posOnly.filter((p) => !p.note).length + appOnly.filter((a) => !a.note).length,
    closed: cl ? { at: cl.at, by: cl.by === null ? null : Number(cl.by) } : null,
  };
}

/**
 * 자동 대조 (쓰기, 멱등) — 미배정 POS ↔ 미배정 앱 항목을 같은 금액끼리, 여럿이면 시각 순서로.
 * ingest 직후와 [다시 맞추기]에서 부른다. 자국은 '확정'·method '자동'.
 */
export async function autoMatchPosDayCore(day: string, uid: number | null): Promise<number> {
  const data = await posDayData(day);
  const byAmt = new Map<number, { pos: PosRow[]; app: AppItem[] }>();
  for (const p of data.posOnly) {
    if (p.note) continue;
    const g = byAmt.get(p.amount) ?? { pos: [], app: [] };
    g.pos.push(p);
    byAmt.set(p.amount, g);
  }
  for (const a of data.appOnly) {
    if (a.note) continue;
    const g = byAmt.get(a.amount);
    if (g) g.app.push(a);
  }
  let n = 0;
  for (const g of byAmt.values()) {
    if (g.pos.length === 0 || g.app.length === 0) continue;
    g.pos.sort((x, y) => (x.paidAt < y.paidAt ? -1 : 1));
    g.app.sort((x, y) => ((x.at ?? "") < (y.at ?? "") ? -1 : 1));
    const k = Math.min(g.pos.length, g.app.length);
    for (let i = 0; i < k; i++) {
      await db.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
        VALUES ('포스결제', 'pos_txn', ${g.pos[i].id}, ${REF_TABLE[g.app[i].kind]}, ${g.app[i].refId}, ${g.pos[i].amount}, '확정', '자동', ${uid}, now())
      `);
      n++;
    }
  }
  return n;
}

/** 달의 날짜별 요약 — 카드 화면 표·현황·마감 체크리스트 */
export interface PosDaySummary {
  day: string;
  posCard: number;
  appCard: number;
  matched: number;
  open: number;
  closed: boolean;
}

export async function posDaysSummary(ym: string): Promise<PosDaySummary[]> {
  const rows = await db.execute<{ day: string; s: string; matched: number; live: number }>(sql`
    SELECT to_char(p.day, 'YYYY-MM-DD') AS "day",
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = '카드'), 0)::bigint s,
           count(*) FILTER (WHERE p.method = '카드' AND p.amount > 0 AND m.id IS NOT NULL)::int matched,
           count(*) FILTER (WHERE p.method = '카드' AND p.amount > 0)::int live
    FROM pos_txn p
    LEFT JOIN recon_match m ON m.kind = '포스결제' AND m.src_table = 'pos_txn' AND m.src_id = p.id AND m.status = '확정'
    WHERE p.is_active AND to_char(p.day, 'YYYY-MM') = ${ym}
    GROUP BY 1 ORDER BY 1 LIMIT 40
  `);
  const closed = await db.execute<{ day: string }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS "day" FROM pos_close WHERE to_char(day, 'YYYY-MM') = ${ym} LIMIT 40
  `);
  const closedSet = new Set(closed.map((c) => c.day));
  const noted = await db.execute<{ day: string; n: number }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS "day", count(*)::int n FROM pos_note WHERE to_char(day, 'YYYY-MM') = ${ym} GROUP BY 1 LIMIT 40
  `);
  const notedMap = new Map(noted.map((r) => [r.day, Number(r.n)]));
  const out: PosDaySummary[] = [];
  for (const r of rows) {
    const app = await appCardItems(r.day);
    const appMatched = app.filter(() => true).length; // 단순화: 앱 쪽 미배정은 아래 open 근사
    void appMatched;
    const live = Number(r.live);
    const matched = Number(r.matched);
    const open = Math.max(0, live - matched) + Math.max(0, app.length - matched) - (notedMap.get(r.day) ?? 0);
    out.push({
      day: r.day,
      posCard: Number(r.s),
      appCard: app.reduce((s, a) => s + a.amount, 0),
      matched,
      open: Math.max(0, open),
      closed: closedSet.has(r.day),
    });
  }
  return out;
}
