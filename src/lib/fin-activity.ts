/**
 * ⭐ 「최근 한 일」 정본 (개편 2단계, 2026-09-12) — 사장님 결정 14·15
 *
 *   돈관리에서 사람이 한 일 + 앱이 자동으로 한 일을 fin_activity 한 표에 한 줄씩 남기고,
 *   되돌리기는 /finance/activity 한 곳에서 **기존 undo 함수만** 불러 한다(새 되돌리기 논리 없음).
 *
 *   · logActivity()     — 코어 함수·액션 본문에서 한 줄. 실패해도 본 일을 막지 않는다(throw 안 함).
 *   · recentActivity()  — 최근 30일 또는 고른 달, 날짜별 묶음.
 *   · closedDelta()     — 마감된 달의 「마감 뒤 고친 것 N건 · 이익 X → Y」.
 *   · autoActivity()    — 「이번 주 정리」 단계의 「앱이 자동 대조한 것」 층 (대상 달·동사, 3단계 2026-09-12).
 *   · undoActivity()    — "use server" 라 fin-activity-actions.ts 에 (코어가 이 파일을 import 하므로 여기는 서버 액션 아님).
 *
 * 🔴 "use server" 아님. 코어(recon-core·deposit-core·pos-close…)가 import 한다.
 * 🔴 트랜잭션 안에서 부를 때 INSERT 가 실패하면 그 트랜잭션이 통째로 깨진다(Postgres) —
 *    가능하면 **커밋 뒤 db 로**(기본값) 부른다. tx 를 넘기는 건 「되돌아가면 기록도 같이 사라져야」 할 때만.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ActivityDay, ActivityEntry, ActivityHow, ActivityRow, ActivityVerb, ClosedDelta, UndoItem, UndoKind } from "./fin-activity-types";
import type { AutoLine } from "./weekly-types";
import { finPL } from "./fin-pl";
import { monthRange } from "./ym";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ActivityRunner = Tx | typeof db;

/** 오늘(KST) 달 YYYY-MM */
function kstYm(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

/**
 * 한 줄 기록. 절대 throw 하지 않는다.
 *   after_close = 대상 달이 이미 마감돼 있으면 true (첫 화면 「N월 마감 뒤 고친 것」 띠).
 */
export async function logActivity(e: ActivityEntry, runner: ActivityRunner = db): Promise<void> {
  try {
    const ym = e.ym ?? kstYm();
    const undoArgs = e.undo ? JSON.stringify(e.undo.args) : null;
    await runner.execute(sql`
      INSERT INTO fin_activity
        (ym, actor, how, verb, target_table, target_id, n, amount, label, undo_kind, undo_args, after_close)
      VALUES (
        ${ym}, ${e.actor ?? null}, ${e.how}, ${e.verb},
        ${e.target?.table ?? null}, ${e.target?.id ?? null},
        ${Math.max(1, Math.round(e.n ?? 1))}, ${e.amount == null ? null : Math.round(e.amount)},
        ${e.label.slice(0, 300)}, ${e.undo?.kind ?? null}, ${undoArgs}::jsonb,
        EXISTS (SELECT 1 FROM month_close WHERE ym = ${ym})
      )
    `);
  } catch (err) {
    console.warn("[fin-activity] 기록 실패 —", (err as Error).message);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 읽기 — 화면 /finance/activity 와 첫 화면 띠가 부른다. 인라인 SQL 은 이 파일에만(정본 하나).
 * ──────────────────────────────────────────────────────────────────────────── */

type ActivityDbRow = {
  id: number;
  at_iso: string;
  at_label: string;
  d: string;
  ym: string | null;
  actor: number | null;
  actor_name: string | null;
  how: string;
  verb: string;
  target_table: string | null;
  target_id: number | null;
  n: number;
  amount: string | number | null;
  label: string;
  undo_kind: string | null;
  undo_args: unknown;
  undone_at: string | null;
  after_close: boolean;
};

/** undo_args jsonb 가 문자열로 올 수도, 객체로 올 수도 있다 — 둘 다 받는다 */
export function parseUndoArgs(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/** bulk 줄의 items — undo_args.items 가 배열이면 그대로 */
export function undoItemsOf(args: Record<string, unknown> | null): UndoItem[] | null {
  const items = args?.items;
  return Array.isArray(items) ? (items as UndoItem[]) : null;
}

/**
 * 최근 한 일 — 기본 최근 30일, ym 을 주면 그 달(at 이 KST 기준 그 달). 날짜별(KST) 묶음, 최신 먼저.
 *   who='사람' 은 how='사람', who='자동' 은 앱이 한 일 전부(자동·조정·cron·연간실행) — 사장님 2단계 답 「자동은 따로 묶어서」.
 *   🔴 질의 한 번. LIMIT 1000 — 한 달에 이보다 많으면 어차피 화면에서 못 읽는다.
 */
export async function recentActivity(
  opts: { ym?: string | null; days?: number; who?: "사람" | "자동" | null } = {},
): Promise<ActivityDay[]> {
  const days = Math.max(1, Math.round(opts.days ?? 30));
  let timeCond;
  if (opts.ym) {
    const { start, nextStart } = monthRange(opts.ym);
    timeCond = sql`a.at >= (${start}::timestamp AT TIME ZONE 'Asia/Seoul') AND a.at < (${nextStart}::timestamp AT TIME ZONE 'Asia/Seoul')`;
  } else {
    timeCond = sql`a.at >= now() - (${days} || ' days')::interval`;
  }
  const whoCond =
    opts.who === "사람" ? sql`AND a.how = '사람'`
    : opts.who === "자동" ? sql`AND a.how IN ('자동','조정','cron','연간실행')`
    : sql``;

  const rows = await db.execute<ActivityDbRow>(sql`
    SELECT a.id,
           to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') at_iso,
           to_char(a.at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at_label,
           to_char(a.at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
           a.ym, a.actor, u.name actor_name, a.how, a.verb, a.target_table, a.target_id,
           a.n, a.amount, a.label, a.undo_kind, a.undo_args,
           to_char(a.undone_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') undone_at,
           a.after_close
    FROM fin_activity a
    LEFT JOIN app_user u ON u.id = a.actor
    WHERE ${timeCond} ${whoCond}
    ORDER BY a.at DESC, a.id DESC
    LIMIT 1000
  `);

  const days_: ActivityDay[] = [];
  for (const r of rows) {
    const args = parseUndoArgs(r.undo_args);
    const row: ActivityRow = {
      id: Number(r.id),
      at: r.at_iso,
      atLabel: r.at_label,
      ym: r.ym,
      actor: r.actor == null ? null : Number(r.actor),
      actorName: r.actor_name,
      how: r.how as ActivityHow,
      verb: r.verb as ActivityVerb,
      targetTable: r.target_table,
      targetId: r.target_id == null ? null : Number(r.target_id),
      n: Number(r.n ?? 1),
      amount: r.amount == null ? null : Number(r.amount),
      label: r.label,
      undoKind: (r.undo_kind as UndoKind | null) ?? null,
      undoItems: r.undo_kind === "bulk" ? undoItemsOf(args) : null,
      undoneAt: r.undone_at,
      afterClose: !!r.after_close,
    };
    const last = days_[days_.length - 1];
    if (last && last.d === r.d) last.rows.push(row);
    else days_.push({ d: r.d, rows: [row] });
  }
  return days_;
}

/**
 * ⭐ 「앱이 자동 대조한 것」 층 재료 (개편 3단계 「이번 주 정리」, 2026-09-12)
 *
 *   단계 ③④⑥의 첫 층은 「앱이 자동으로 한 것」을 접어 보여 준다. cash_txn 엔 「누가 분류했나」가
 *   없어 다른 길로 세면 새 판정이 된다 — 그래서 fin_activity 를 **되읽는다**(대상 달·동사 기준,
 *   how 는 recentActivity 의 「자동」 묶음과 같은 넷, 되돌린 줄 제외). 되돌리기는 「최근 한 일」 한 곳.
 *   🔴 이 표의 SQL 은 이 파일에만(머리말 원칙). LIMIT 50 — 접힌 층이라 그 이상은 안 읽힌다.
 */
export async function autoActivity(ym: string, verb: ActivityVerb): Promise<AutoLine[]> {
  const rows = await db.execute<{ id: number; at: string; label: string; n: number; amount: string | number | null }>(sql`
    SELECT a.id, to_char(a.at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') at, a.label, a.n, a.amount
    FROM fin_activity a
    WHERE a.ym = ${ym} AND a.verb = ${verb}
      AND a.how IN ('자동','조정','cron','연간실행') AND a.undone_at IS NULL
    ORDER BY a.at DESC, a.id DESC
    LIMIT 50
  `);
  return rows.map((r) => ({
    id: Number(r.id),
    at: r.at,
    label: r.label,
    n: Number(r.n ?? 1),
    amount: r.amount == null ? null : Number(r.amount),
  }));
}

/**
 * 마감 뒤 고침 띠 — 사장님 결정 15 「마감 뒤 고치면 기록에 남고 마감 때 숫자와의 차이를 보여 줌」.
 *   month_close 에 그 달이 없으면 null · after_close 줄(되돌린 것 제외)이 0이면 null(띠 안 띄움).
 *   closedProfit = 마감 때 headline.profit · nowProfit = 지금 finPL(ym).profit — 같은 식(computeHeadline 도 finPL).
 *   🔴 질의 순차.
 */
export async function closedDelta(ym: string): Promise<ClosedDelta | null> {
  const mc = await db.execute<{ p: string | null }>(sql`
    SELECT headline->>'profit' p FROM month_close WHERE ym = ${ym} LIMIT 1
  `);
  if (!mc[0]) return null;
  const cnt = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM fin_activity
    WHERE ym = ${ym} AND after_close AND undone_at IS NULL
  `);
  const n = Number(cnt[0]?.n ?? 0);
  if (n === 0) return null;
  const pl = await finPL(ym);
  return { ym, n, closedProfit: Number(mc[0].p ?? 0), nowProfit: pl.profit };
}
