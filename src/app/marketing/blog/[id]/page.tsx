import { notFound, redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { getDraft } from "@/lib/blog-draft";
import { folderName, folderVideos, publishReady } from "@/lib/blog-photo";
import { PageHeader, PageShell } from "@/components/ui/page";
import { DraftEditor } from "./draft-ui";

export const dynamic = "force-dynamic";

export default async function BlogDraftPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  const { id } = await params;
  const d = await getDraft(Number(id));
  if (!d) notFound();

  /**
   * 🔴 사진을 끌어다 네이버에 붙이시므로, **어느 사진이 고화질로 준비됐는지**를
   *    화면이 알아야 한다 (2026-09-05). 준비 안 된 것을 끌면 160px 이 올라간다.
   * 🔴 질의는 순차로 — 풀러가 동시 질의에 약하다.
   */
  const plan = (d.photoPlan ?? null) as { photoId: number; slot: string; caption: string }[] | null;
  const ready = d.folderId ? await publishReady(d.folderId) : [];
  const videos = d.folderId ? await folderVideos(d.folderId) : [];
  const folder = d.folderId ? await folderName(d.folderId) : null;

  return (
    <PageShell>
      <PageHeader title="블로그 초안" back={{ href: "/marketing/blog", label: "초안 목록" }} />
      <DraftEditor
        draft={{
          id: d.id,
          status: d.status,
          titles: d.titles,
          body: d.body,
          tags: d.tags,
          ownerNote: d.ownerNote,
          facts: d.facts,
          warn: d.warn,
          source: d.source,
          photoPlan: plan,
        }}
        photos={{ ready, videos, folder }}
      />
    </PageShell>
  );
}
