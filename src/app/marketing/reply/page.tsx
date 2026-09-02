import { redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { ReplyForm } from "./reply-ui";

export const dynamic = "force-dynamic";

/** 리뷰 답글 초안 — 붙여넣기 → 초안 → 복사. 저장하지 않는다 */
export default async function ReplyPage() {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  return (
    <PageShell>
      <PageHeader title="리뷰 답글 초안" back={{ href: "/marketing", label: "마케팅" }} />
      <p className="text-[13px] leading-snug text-slate-500">
        스마트플레이스 앱 알림으로 온 리뷰를 여기 붙여넣으세요. 답글 초안을 만들어 드리면 복사해서 플레이스 앱에 다시
        붙여넣어 등록합니다. 여기서는 아무것도 저장하지 않습니다.
      </p>
      <ReplyForm />
    </PageShell>
  );
}
