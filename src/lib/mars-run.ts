"use server";

/**
 * MARS 자동 입력 — 웹 버튼 쪽 (사장님 요청 2026-08-04)
 *
 *   "npm 으로 시작하는 콘솔 명령어라는 점이 불편함.
 *    웹페이지에 버튼이라도 따로 있었으면 좋겠음."
 *
 * 버튼은 **요청을 남길 뿐**이다. 실제 실행은 사장님 PC 의 `scripts/mars-agent.ts` 가
 * 한다 — MARS 로그인·크롬 프로필이 그 PC 에 있기 때문이다 (스키마 mars_run 주석).
 * 에이전트가 꺼져 있으면 요청이 「대기」로 남는데, 화면이 그걸 알려 준다.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { marsRun } from "@/db/schema";
import { getSession } from "./auth";

export interface MarsRunRow {
  id: number;
  kind: string;
  status: string;
  log: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 실행을 요청한다 — 이미 대기·실행중이면 그걸 알려주고 새로 만들지 않는다 */
export async function requestMarsRun(
  kind: "입력" | "점검",
): Promise<{ ok: true; runId: number; existing: boolean } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };

  const [open] = await db
    .select({ id: marsRun.id })
    .from(marsRun)
    .where(inArray(marsRun.status, ["대기", "실행중"]))
    .limit(1);
  if (open) {
    revalidatePath("/mars");
    return { ok: true, runId: open.id, existing: true };
  }

  const [r] = await db
    .insert(marsRun)
    .values({ kind, requestedBy: session.uid ?? null })
    .returning({ id: marsRun.id });
  revalidatePath("/mars");
  return { ok: true, runId: r.id, existing: false };
}

/** 가장 최근 실행 하나 — 화면이 몇 초마다 다시 불러 진행을 보여준다 */
export async function latestMarsRun(): Promise<MarsRunRow | null> {
  const rows = await db.execute<{
    id: number;
    kind: string;
    status: string;
    log: string | null;
    requested_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(sql`
    SELECT id, kind, status, log,
           to_char(requested_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') requested_at,
           to_char(started_at   AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') started_at,
           to_char(finished_at  AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') finished_at
    FROM mars_run ORDER BY id DESC LIMIT 1`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    kind: r.kind,
    status: r.status,
    log: r.log,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/**
 * 굳어 버린 요청을 지운다 — 에이전트가 꺼진 채 「대기」로 남았을 때.
 * 실행중인 것은 30분이 지나야 지울 수 있다 (진짜 돌고 있을 수 있다).
 */
export async function cancelMarsRun(runId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [r] = await db
    .select({ id: marsRun.id, status: marsRun.status, startedAt: marsRun.startedAt })
    .from(marsRun)
    .where(eq(marsRun.id, runId))
    .limit(1);
  if (!r) return { ok: false, error: "요청을 찾을 수 없습니다" };
  if (r.status === "실행중" && r.startedAt && Date.now() - r.startedAt.getTime() < 30 * 60 * 1000) {
    return { ok: false, error: "지금 실행 중입니다 — 30분이 지나도 안 끝나면 지울 수 있습니다" };
  }
  await db
    .update(marsRun)
    .set({ status: "실패", log: sql`COALESCE(${marsRun.log} || E'\n', '') || '(화면에서 중단 처리)'`, finishedAt: new Date() })
    .where(and(eq(marsRun.id, runId), inArray(marsRun.status, ["대기", "실행중"])));
  revalidatePath("/mars");
  return { ok: true };
}
