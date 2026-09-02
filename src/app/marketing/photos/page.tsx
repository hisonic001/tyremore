import { redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { autoLinkFolders, listFolders } from "@/lib/blog-photo";
import { blogAgentStatus } from "@/lib/blog-job";
import { EmptyState } from "@/components/ui/empty";
import { PageHeader, PageShell } from "@/components/ui/page";
import { FoldersUI } from "./folders-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 사진 폴더 목록 (C단계, 2026-09-02)
 *
 * 사장님이 이미 쓰시는 `블로그 작업후기\` 폴더를 그대로 보여 준다.
 * `(미업로드)` 가 위에 온다 — 그게 사장님의 실제 대기열이다.
 *
 * 🔴 원본은 서버로 오지 않는다. 160px 미리보기만 오고, 그것도 화면 데이터에 싣지 않고
 *    `/api/blog-photo/{id}/thumb` 이 한 장씩 내려 준다.
 */
export default async function PhotosPage() {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  // 🔴 순차로 (Promise.all 금지 — 2026-08-11 풀러 마비 사건)
  await autoLinkFolders().catch(() => 0);
  const folders = await listFolders();
  const agent = await blogAgentStatus();

  return (
    <PageShell>
      <PageHeader title="사진으로 원고 만들기" back={{ href: "/marketing", label: "마케팅" }} />
      <p className="text-[13px] leading-snug text-slate-500">
        매장 PC 의 <strong>블로그 작업후기</strong> 폴더를 그대로 봅니다. 사진을 고르고 후기를
        누르면 원고에 <strong>사진 자리</strong>까지 잡아 드립니다.
      </p>

      {folders.length === 0 ? (
        <EmptyState
          emoji="📁"
          title="아직 폴더를 못 읽었습니다"
          hint="매장 PC 를 켜신 뒤 아래 「사진 다시 훑기」를 눌러 주세요."
          action={<FoldersUI folders={[]} agent={agent} />}
        />
      ) : (
        <FoldersUI folders={folders} agent={agent} />
      )}
    </PageShell>
  );
}
