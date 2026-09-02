import { redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { recentSalesForBlog } from "@/lib/blog-draft";
import { blogAgentStatus } from "@/lib/blog-job";
import { PageHeader, PageShell } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/empty";
import { WriteUI } from "./write-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 작업 후기 쓰고 원고 만들기 (B단계, 2026-09-02)
 *
 * 사장님 평가: "자연스러움이 없으며 ai가 작성한 티가 남."
 * 원인은 문체가 아니라 **재료**였다. 시공 기록만으로는 쓸 사건이 없어 일반론이 된다.
 * 이 화면이 왜 오셨고·뭘 보셨고·왜 이걸 권했는지를 **누르는 것만으로** 받는다.
 */
export default async function WritePage() {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  // 🔴 풀러를 아끼려고 순차로 (Promise.all 금지 — 2026-08-11 마비 사건)
  const sales = await recentSalesForBlog();
  const agent = await blogAgentStatus();

  return (
    <PageShell>
      <PageHeader title="작업 후기 쓰고 원고 만들기" back={{ href: "/marketing", label: "마케팅" }} />
      <p className="text-[13px] leading-snug text-slate-500">
        시공 하나를 고르고 <strong>왜 오셨는지·무엇을 보셨는지</strong>만 눌러 주세요. 손으로 쓰실
        건 없습니다. 측정한 숫자를 넣으시면 글이 눈에 띄게 좋아집니다.
      </p>

      {sales.length === 0 ? (
        <EmptyState
          emoji="🔧"
          title="최근 30일 타이어 시공이 없습니다"
          hint="거래처 판매와 무상 서비스는 글감에서 빠집니다."
        />
      ) : (
        <WriteUI sales={sales} agent={agent} />
      )}
    </PageShell>
  );
}
