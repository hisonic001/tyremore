import { notFound, redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { folderSaleSummary, getFolder, listPhotos } from "@/lib/blog-photo";
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
  /** 번호판으로 못 이었을 때 직접 고르시게 — `3.4` 처럼 이름에 번호판이 없는 폴더가 실제로 있다 */
  const sales = sale ? [] : await recentSalesForBlog(60, 40);
  const agent = await blogAgentStatus();

  return (
    <PageShell>
      <PageHeader title={folder.label} back={{ href: "/marketing/photos", label: "사진 폴더" }} />
      <PickerUI folder={folder} photos={photos} sale={sale} sales={sales} agent={agent} />
    </PageShell>
  );
}
