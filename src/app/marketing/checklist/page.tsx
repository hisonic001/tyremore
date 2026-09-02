import { redirect } from "next/navigation";
import { hasPerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { ChecklistUI } from "./checklist-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 촬영 체크리스트 (2026-09-02)
 *
 * 사장님 요청: "중구난방으로 사진을 찍기보다 정확히 어떤 사진을 몇장 찍어야 하는지."
 * 목록은 제가 지어낸 게 아니라 **사장님 폴더에서 뽑았습니다** — 벤츠 GLS 폴더에
 * 손수 붙여 두신 A(입고)·B(작업)·C(출고) 3막이 그대로 뼈대입니다 (photo-checklist.ts).
 */
export default async function ChecklistPage() {
  if (!(await hasPerm("marketing"))) redirect("/settings");
  return (
    <PageShell>
      <PageHeader title="촬영 체크리스트" back={{ href: "/marketing", label: "마케팅" }} />
      <p className="text-[13px] leading-snug text-slate-500">
        작업 종류를 고르면 찍을 사진이 순서대로 나옵니다. <strong>폰으로 이 화면을 보면서</strong>{" "}
        하나씩 찍고 눌러 지워 가세요. 지금 찍으시는 양(17~24장)이면 충분합니다 — 문제는 모자란 게
        아니라 <strong>같은 컷이 겹치는 것</strong>입니다.
      </p>
      <ChecklistUI />
    </PageShell>
  );
}
