"use server";

/**
 * 블로그 초안 화면의 서버 액션 (마케팅 1단계, 2026-08-29)
 * 전부 사장님 전용 — 정비사 계정은 거절한다.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blogDraft } from "@/db/schema";
import { isOwner } from "./auth";
import { factsForDay, generateDraft, getDraft, runNightly } from "./blog-draft";

type R = { ok: true } | { ok: false; error: string };

async function guard(): Promise<string | null> {
  return (await isOwner()) ? null : "사장님 계정만 쓸 수 있습니다";
}

/** 「오늘 초안 만들기」 — 크론을 기다리지 않고 지금 */
export async function makeTodayDrafts(): Promise<R & { made?: number; skipped?: string[] }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const { results } = await runNightly({ limit: 2 });
  const made = results.filter((r) => r.result?.ok).length;
  const skipped = results.filter((r) => r.result && !r.result.ok).map((r) => `${r.quoteNo}: ${(r.result as { error: string }).error}`);
  revalidatePath("/marketing/blog");
  revalidatePath("/");
  if (results.length === 0) return { ok: false, error: "오늘 성사된 타이어 시공이 없습니다 (거래처·무상 건은 뺍니다)" };
  return { ok: true, made, skipped };
}

/** 「다르게 한 번 더」 — 같은 시공으로 구조를 바꿔 새 초안 */
export async function regenerateDraft(id: number): Promise<R & { newId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const d = await getDraft(id);
  if (!d?.quoteId) return { ok: false, error: "원래 시공을 찾지 못했습니다" };
  const [f] = await factsForDay("", { quoteId: d.quoteId });
  if (!f) return { ok: false, error: "시공 내역이 바뀌어 사실을 다시 읽지 못했습니다" };
  const r = await generateDraft(f, { variant: 1 + (id % 3) });
  if (!r.ok) return r;
  revalidatePath("/marketing/blog");
  return { ok: true, newId: r.id };
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
