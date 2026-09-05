import { notFound, redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { folderDrafts, folderSaleSummary, getFolder, listPhotos } from "@/lib/blog-photo";
import { blogAgentStatus } from "@/lib/blog-job";
import { recentSalesForBlog } from "@/lib/blog-draft";
import { PageHeader, PageShell } from "@/components/ui/page";
import { PickerUI } from "./picker-ui";

export const dynamic = "force-dynamic";

/** 폴더 하나 — 사진 고르기 + 작업 후기 + 원고 만들기 (C단계, 2026-09-02) */
export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  const { id } = await params;
  const folderId = Number(id);

  // 🔴 순차로 (Promise.all 금지 — 2026-08-11 풀러 마비 사건)
  const folder = await getFolder(folderId);
  if (!folder) notFound();
  const photos = await listPhotos(folderId);
  const sale = folder.quoteId ? await folderSaleSummary(folder.quoteId) : null;
  /**
   * 🔴 **늘 목록을 싣는다** (2026-09-05). 예전에는 안 이어진 폴더에만 실었는데,
   *    번호판으로 자동으로 이은 것이 **틀렸을 때 바꿀 길이 없었다.**
   *    (`3.4` 처럼 이름에 번호판이 없는 폴더도 실제로 있다.)
   */
  const sales = await recentSalesForBlog(60, 40);
  const drafts = await folderDrafts(folderId);
  const agent = await blogAgentStatus();

  return (
    <PageShell>
      <PageHeader title={folder.label} back={{ href: "/marketing/photos", label: "사진 폴더" }} />
      <PickerUI folder={folder} photos={photos} sale={sale} sales={sales} drafts={drafts} agent={agent} />
    </PageShell>
  );
}
