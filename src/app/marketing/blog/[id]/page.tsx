import { notFound, redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { getDraft } from "@/lib/blog-draft";
import { PageHeader, PageShell } from "@/components/ui/page";
import { DraftEditor } from "./draft-ui";

export const dynamic = "force-dynamic";

export default async function BlogDraftPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  const { id } = await params;
  const d = await getDraft(Number(id));
  if (!d) notFound();

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
          photoPlan: d.photoPlan ?? null,
        }}
      />
    </PageShell>
  );
}
