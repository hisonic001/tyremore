"use server";

/**
 * 블로그 초안 화면의 서버 액션 (마케팅 1단계, 2026-08-29)
 * 전부 사장님 전용 — 정비사 계정은 거절한다.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blogDraft } from "@/db/schema";
import { hasPerm } from "./auth";
import { getDraft } from "./blog-draft";
import { requestBlogJob } from "./blog-job";

type R = { ok: true } | { ok: false; error: string };

async function guard(): Promise<string | null> {
  return (await hasPerm("marketing")) ? null : "마케팅 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
}

/**
 * 「오늘 원고 만들기」 — 주문만 남긴다. 실제로 만드는 것은 매장 PC 대리인이다.
 * 🔴 여기(Vercel)에서 직접 만들지 않는다 — 클로드 **구독**은 그 PC 에만 로그인되어 있다.
 */
export async function makeTodayDrafts(): Promise<R & { jobId?: number; existing?: boolean }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const r = await requestBlogJob("초안", { limit: 2 });
  if (!r.ok) return r;
  return { ok: true, jobId: r.jobId, existing: r.existing };
}

/** 「다르게 한 번 더」 — 같은 시공으로 구조를 바꿔 새 원고. 이것도 매장 PC 가 만든다 */
export async function regenerateDraft(id: number): Promise<R & { jobId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const d = await getDraft(id);
  if (!d?.quoteId) return { ok: false, error: "원래 시공을 찾지 못했습니다" };
  const r = await requestBlogJob("초안", { quoteId: d.quoteId, variant: 1 + (id % 3) });
  if (!r.ok) return r;
  return { ok: true, jobId: r.jobId };
}

export async function saveOwnerNote(id: number, note: string): Promise<R> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  await db.update(blogDraft).set({ ownerNote: note.trim() || null, updatedAt: new Date() }).where(eq(blogDraft.id, id));
  return { ok: true };
}

export async function setDraftStatus(id: number, status: "초안" | "발행" | "버림"): Promise<R> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  await db
    .update(blogDraft)
    .set({ status, publishedAt: status === "발행" ? new Date() : null, updatedAt: new Date() })
    .where(eq(blogDraft.id, id));
  revalidatePath("/marketing/blog");
  revalidatePath("/");
  return { ok: true };
}
