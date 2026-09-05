"use server";

/**
 * 블로그 초안 화면의 서버 액션 (마케팅 1단계, 2026-08-29)
 * 전부 사장님 전용 — 정비사 계정은 거절한다.
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { blogDraft, blogFolder } from "@/db/schema";
import { hasPerm } from "./auth";
import { getDraft } from "./blog-draft";
import { formHasMaterial, sanitizeForm } from "./blog-form";
import { requestBlogJob } from "./blog-job";

type R = { ok: true } | { ok: false; error: string };

async function guard(): Promise<string | null> {
  return (await hasPerm("marketing")) ? null : "마케팅 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
}

/**
 * 🔴 「오늘 원고 만들기」는 없앴다 (사장님 지시 2026-09-05).
 *
 * 예전에는 이 자리에서 `requestBlogJob("초안", { limit: 2 })` 로 주문을 넣으면
 * 매장 PC 가 **그날 시공에서 2건을 스스로 골라** 원고를 만들었다.
 * 사장님은 **쓸 작업을 직접 고르고 그때그때 1~2건 만들기**를 원하신다.
 * 그래서 원고는 아래 두 길로만 만든다 — `writeWithPhotos`(사진 폴더에서 고름) ·
 * `writeWithForm`(시공에서 고름) · `generateTopicDraft`(정보성 글).
 *
 * **프로그램이 대신 고르는 길은 다시 만들지 말 것.**
 */

/**
 * ⭐ 「작업 후기 쓰고 원고 만들기」 (B단계, 2026-09-02)
 *
 * 사장님 평가 "ai가 작성한 티가 남" 의 근본 처방. 왜 오셨고·뭘 봤고·왜 이걸 권했는지가
 * 들어가면 모델이 일반론을 쓸 이유가 없어진다. 재료가 하나도 없으면 아예 안 받는다.
 */
export async function writeWithForm(
  quoteId: number,
  rawForm: unknown,
): Promise<R & { jobId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const form = sanitizeForm(rawForm);
  if (!formHasMaterial(form)) {
    return {
      ok: false,
      error: "왜 오셨는지·무엇을 보셨는지 중 하나는 골라 주세요 — 그게 없으면 뻔한 글이 됩니다",
    };
  }
  const r = await requestBlogJob("초안", { quoteId, form: form as unknown as Record<string, unknown> });
  if (!r.ok) return r;
  return { ok: true, jobId: r.jobId };
}

/**
 * ⭐ 「사진으로 원고 만들기」 (C단계, 2026-09-02)
 *
 * 사진 폴더 + 작업 후기 → 본문에 **사진 자리표시자**가 박힌 원고.
 * 🔴 사진 원본은 서버로 오지 않는다. 여기서는 고른 **순서(id 배열)** 만 넘기고,
 *    매장 PC 대리인이 자기 디스크에서 원본을 읽는다.
 */
export async function writeWithPhotos(
  folderId: number,
  photoIds: number[],
  rawForm: unknown,
): Promise<R & { jobId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const form = sanitizeForm(rawForm);
  if (!formHasMaterial(form)) {
    return { ok: false, error: "왜 오셨는지·무엇을 보셨는지 중 하나는 골라 주세요" };
  }
  const [row] = await db
    .select({ quoteId: blogFolder.quoteId })
    .from(blogFolder)
    .where(eq(blogFolder.id, folderId))
    .limit(1);
  if (!row?.quoteId) return { ok: false, error: "이 폴더가 어느 시공인지 먼저 골라 주세요" };

  const ids = photoIds.filter((n) => Number.isFinite(n)).slice(0, 60).map(Number);
  const r = await requestBlogJob("초안", {
    quoteId: row.quoteId,
    folderId,
    photoIds: ids,
    form: form as unknown as Record<string, unknown>,
  });
  if (!r.ok) return r;
  return { ok: true, jobId: r.jobId };
}

/**
 * 「다르게 한 번 더」 — 같은 시공으로 각도를 바꿔 새 원고. 이것도 매장 PC 가 만든다.
 * 사장님이 채우셨던 후기가 있으면 **그대로 다시 쓴다** (두 번 채우실 이유가 없다).
 */
export async function regenerateDraft(id: number): Promise<R & { jobId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const d = await getDraft(id);
  if (!d?.quoteId) return { ok: false, error: "원래 시공을 찾지 못했습니다" };
  const r = await requestBlogJob("초안", {
    quoteId: d.quoteId,
    variant: 1 + (id % 3),
    ...(d.form ? { form: d.form } : {}),
  });
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
  const d = await getDraft(id);
  await db
    .update(blogDraft)
    .set({ status, publishedAt: status === "발행" ? new Date() : null, updatedAt: new Date() })
    .where(eq(blogDraft.id, id));

  /**
   * 🔴 다 올렸거나 버렸으면 **발행용 사진(1280px)을 지운다** (2026-09-05).
   *    한 건에 3MB 라 놔두면 1년에 수백 MB 가 쌓인다. 올린 뒤엔 쓸 일이 없고,
   *    다시 필요하면 화면의 「사진 고화질로 준비」로 언제든 다시 만든다.
   */
  if (d?.folderId && status !== "초안") {
    await db.execute(sql`
      UPDATE blog_photo SET publish = NULL
      WHERE folder_id = ${d.folderId} AND publish IS NOT NULL`);
  }

  revalidatePath("/marketing/blog");
  revalidatePath("/");
  return { ok: true };
}

/**
 * ⭐ 「사진 고화질로 준비」 (2026-09-05)
 *
 * 화면의 사진을 끌어다 네이버에 붙이면 목록용 160px 이 그대로 올라간다. 그래서 발행용
 * 1280px 한 벌을 따로 굽는다. 🔴 굽는 일은 늘 **매장 PC 몫**이다 — Vercel 은 사장님
 * 사진 폴더를 볼 수 없다. 그래서 여기서는 주문만 남긴다.
 */
export async function preparePublishImages(id: number): Promise<R & { jobId?: number }> {
  const g = await guard();
  if (g) return { ok: false, error: g };
  const d = await getDraft(id);
  if (!d?.folderId) return { ok: false, error: "이 글에는 사진 폴더가 이어져 있지 않습니다" };
  if (!d.photoPlan) return { ok: false, error: "이 글에는 사진 계획이 없습니다" };
  const r = await requestBlogJob("발행사진", { draftId: id });
  if (!r.ok) return r;
  return { ok: true, jobId: r.jobId };
}
