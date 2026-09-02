import { redirect } from "next/navigation";
import Link from "@/lib/link";
import { isOwner } from "@/lib/auth";
import { listDrafts } from "@/lib/blog-draft";
import { blogAgentStatus, latestBlogJob } from "@/lib/blog-job";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { PageHeader, PageShell } from "@/components/ui/page";
import { MakeTodayButton } from "./make-today";

export const dynamic = "force-dynamic";

/** 블로그 초안 목록 — 아직 안 올린 것이 위에 온다 */
export default async function BlogDraftList() {
  if (!(await isOwner())) redirect("/settings");
  // 🔴 풀러를 아끼려고 순차로 부른다 (Promise.all 금지 — 2026-08-11 마비 사건)
  const rows = await listDrafts();
  const agent = await blogAgentStatus();
  const job = await latestBlogJob();
  const fmt = (d: Date) => d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });

  return (
    <PageShell>
      <PageHeader
        title="블로그 초안"
        back={{ href: "/marketing", label: "마케팅" }}
        action={<MakeTodayButton agent={agent} job={job} />}
      />
      <p className="text-[13px] leading-snug text-slate-500">
        「오늘 원고 만들기」를 누르면 <strong>매장 PC</strong>가 그날 시공에서 2건을 골라 원고를 만듭니다(1~3분).
        초안을 열어 <strong>한마디</strong>를 쓰면 복사가 됩니다 — 네이버 블로그 앱에 붙여넣고 사진을 골라 올리세요.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          emoji="✍️"
          title="아직 초안이 없습니다"
          hint="오늘 타이어 시공이 있었다면 위의 「오늘 원고 만들기」로 지금 만들 수 있습니다. 매장 PC 가 켜져 있어야 합니다."
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/marketing/blog/${r.id}`}
                className="block rounded-card border border-slate-200 bg-white p-4 active:bg-slate-50 lg:hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-semibold leading-snug">{r.title}</p>
                  <StatusPill tone={r.status === "발행" ? "success" : r.hasNote ? "info" : "accent"}>
                    {r.status === "발행" ? "올림" : r.hasNote ? "복사 가능" : "한마디 필요"}
                  </StatusPill>
                </div>
                <p className="mt-1 whitespace-pre-line text-[13px] leading-snug text-slate-500">
                  {r.facts.split("\n").slice(0, 2).join("\n")}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {fmt(r.createdAt)} · {r.quoteNo ?? "—"}
                </p>
                {r.warn && <p className="mt-1 text-xs text-amber-700">⚠ {r.warn}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
