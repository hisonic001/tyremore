"use server";

/**
 * 글감 — 앱 쪽 서버 액션 (D단계, 2026-09-02)
 *
 * 「차종별 순정 제원」·「차량 관리팁」 같은 **시공 없는 정보성 글**을 주문한다.
 * 이 카테고리는 시공이 없어도 쓸 수 있어 글감이 마르지 않고, 검색 의도가 분명해
 * 이 매장 블로그에서 가장 저평가된 자리다.
 */
import { hasPerm } from "./auth";
import { requestBlogJob } from "./blog-job";

type R = { ok: true; jobId?: number } | { ok: false; error: string };

export async function writeTopic(topic: {
  title: string;
  category: string;
  material: string;
}): Promise<R> {
  if (!(await hasPerm("marketing"))) return { ok: false, error: "마케팅 권한이 없습니다" };

  const t = {
    title: String(topic.title ?? "").trim().slice(0, 120),
    category: String(topic.category ?? "").trim().slice(0, 40),
    material: String(topic.material ?? "").trim().slice(0, 1200),
  };
  if (!t.title) return { ok: false, error: "글 주제가 비어 있습니다" };

  const r = await requestBlogJob("초안", { topic: t });
  return r.ok ? { ok: true, jobId: r.jobId } : r;
}
