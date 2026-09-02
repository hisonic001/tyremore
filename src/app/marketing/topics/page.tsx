import { redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { suggestTopics } from "@/lib/blog-topics";
import { blogAgentStatus } from "@/lib/blog-job";
import { EmptyState } from "@/components/ui/empty";
import { PageHeader, PageShell } from "@/components/ui/page";
import { TopicsUI } from "./topics-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 이번 주 쓸 글 (D단계, 2026-09-02)
 *
 * 「뭘 쓰지」가 블로그가 멈추는 가장 흔한 이유다. 근거 넷으로 골라 준다:
 *   ① 밀린 사진 폴더 ② 원고 없는 최근 시공 ③ 차종별 순정 제원(시공 없어도 씀) ④ 계절
 *
 * 🔴 서너 개만 보여준다. 열 개를 늘어놓으면 아무것도 안 고르시게 된다.
 */
export default async function TopicsPage() {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  // 🔴 순차로 (Promise.all 금지 — 2026-08-11 풀러 마비 사건)
  const topics = await suggestTopics(4);
  const agent = await blogAgentStatus();

  return (
    <PageShell>
      <PageHeader title="이번 주 쓸 글" back={{ href: "/marketing", label: "마케팅" }} />
      <p className="text-[13px] leading-snug text-slate-500">
        밀린 사진·최근 시공·이 매장 통계·계절을 보고 골랐습니다. 하나만 고르셔서 오늘 한 편
        쓰시면 됩니다.
      </p>

      {topics.length === 0 ? (
        <EmptyState
          emoji="✅"
          title="지금은 밀린 글감이 없습니다"
          hint="사진 폴더도 최근 시공도 모두 글이 있습니다. 다음 시공 때 다시 들러 주세요."
        />
      ) : (
        <TopicsUI topics={topics} agent={agent} />
      )}
    </PageShell>
  );
}
