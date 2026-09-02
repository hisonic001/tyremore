"use server";

/**
 * 블로그 원고 — 앱 버튼 쪽 (v3 1단계, 2026-09-02)
 *
 * 버튼은 **주문만 남긴다.** 실제로 글을 만드는 것은 매장 PC 의
 * `scripts/blog-agent.ts` 다 — 클로드 **구독**이 그 PC 에 로그인되어 있기 때문이다.
 * 대리인이 꺼져 있으면 화면이 그걸 먼저 알려주고 버튼을 잠근다 (요청이 굳는 것 자체를 막는다).
 *
 * mars-run.ts 와 같은 모양이되, 한 가지가 다르다:
 * 🔴 열린 요청을 재사용할 때 **kind 를 가린다.** (mars-run 은 안 가려서, 다른 종류가
 *    돌고 있으면 그 id 를 돌려준다. 여기서는 같은 실수를 하지 않는다.)
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blogJob } from "@/db/schema";
import { getSession, isOwner } from "./auth";

/** 대리인이 살아 있다고 볼 시간 — 15초마다 찍으므로 60초면 넉넉하다 */
const ALIVE_SEC = 60;

export interface BlogJobRow {
  id: number;
  kind: string;
  status: string;
  log: string | null;
  error: string | null;
  draftIds: number[] | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AgentStatus {
  alive: boolean;
  /** 'HH:MM:SS' — 마지막으로 살아 있다고 찍은 시각 */
  lastSeen: string | null;
  version: string | null;
}

/** 매장 PC 대리인이 켜져 있는가 */
export async function blogAgentStatus(): Promise<AgentStatus> {
  const rows = await db.execute<{ alive: boolean; last_seen: string | null; version: string | null }>(sql`
    SELECT now() - last_seen < ${`${ALIVE_SEC} seconds`}::interval AS alive,
           to_char(last_seen AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') AS last_seen,
           version
    FROM agent_heartbeat WHERE name = 'blog'`);
  const r = rows[0];
  if (!r) return { alive: false, lastSeen: null, version: null };
  return { alive: !!r.alive, lastSeen: r.last_seen, version: r.version };
}

/**
 * 원고 만들기를 요청한다 — 이미 대기·실행중인 **같은 종류**가 있으면 그걸 알려준다.
 * 대리인이 꺼져 있으면 아예 안 받는다 (「대기」로 굳어 사장님이 영문을 모르는 일을 막는다).
 */
export async function requestBlogJob(
  kind: "초안",
  payload: Record<string, unknown> = {},
): Promise<{ ok: true; jobId: number; existing: boolean } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님 계정만 쓸 수 있습니다" };
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };

  const agent = await blogAgentStatus();
  if (!agent.alive) {
    return {
      ok: false,
      error:
        "매장 PC 가 꺼져 있습니다 — 글은 그 PC 에서 만들어집니다. PC 를 켜신 뒤 다시 눌러 주세요.",
    };
  }

  const [open] = await db
    .select({ id: blogJob.id })
    .from(blogJob)
    .where(and(eq(blogJob.kind, kind), inArray(blogJob.status, ["대기", "실행중"])))
    .limit(1);
  if (open) {
    revalidatePath("/marketing/blog");
    return { ok: true, jobId: open.id, existing: true };
  }

  const [r] = await db
    .insert(blogJob)
    .values({ kind, payload, requestedBy: session.uid ?? null })
    .returning({ id: blogJob.id });
  revalidatePath("/marketing/blog");
  return { ok: true, jobId: r.id, existing: false };
}

/** 요청 하나 — 화면이 3초마다 다시 불러 진행을 보여준다 */
export async function getBlogJob(jobId: number): Promise<BlogJobRow | null> {
  const rows = await db.execute<{
    id: number;
    kind: string;
    status: string;
    log: string | null;
    error: string | null;
    draft_ids: number[] | null;
    requested_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(sql`
    SELECT id, kind, status, log, error, draft_ids,
           to_char(requested_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') requested_at,
           to_char(started_at   AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') started_at,
           to_char(finished_at  AT TIME ZONE 'Asia/Seoul', 'HH24:MI:SS') finished_at
    FROM blog_job WHERE id = ${jobId}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    kind: r.kind,
    status: r.status,
    log: r.log,
    error: r.error,
    draftIds: r.draft_ids ?? null,
    requestedAt: r.requested_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** 가장 최근 요청 — 화면을 열었을 때 「아직 돌고 있나?」를 알기 위해 */
export async function latestBlogJob(): Promise<BlogJobRow | null> {
  const [row] = await db.select({ id: blogJob.id }).from(blogJob).orderBy(sql`id DESC`).limit(1);
  return row ? getBlogJob(row.id) : null;
}

/** 굳어 버린 요청을 지운다 — 실행중인 것은 10분이 지나야 (원고는 1~3분짜리다) */
export async function cancelBlogJob(
  jobId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "사장님 계정만 쓸 수 있습니다" };
  const [r] = await db
    .select({ status: blogJob.status, startedAt: blogJob.startedAt })
    .from(blogJob)
    .where(eq(blogJob.id, jobId))
    .limit(1);
  if (!r) return { ok: false, error: "요청을 찾을 수 없습니다" };
  if (r.status === "실행중" && r.startedAt && Date.now() - r.startedAt.getTime() < 10 * 60 * 1000) {
    return { ok: false, error: "지금 만드는 중입니다 — 10분이 지나도 안 끝나면 지울 수 있습니다" };
  }
  await db
    .update(blogJob)
    .set({
      status: "실패",
      error: "화면에서 중단했습니다",
      finishedAt: new Date(),
    })
    .where(and(eq(blogJob.id, jobId), inArray(blogJob.status, ["대기", "실행중"])));
  revalidatePath("/marketing/blog");
  return { ok: true };
}
