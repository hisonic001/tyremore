import Link from "@/lib/link";
import { hasPerm } from "@/lib/auth";
import { Notice } from "@/components/ui/notice";
import { PageHeader, PageShell } from "@/components/ui/page";
import { getSpecReview, listSpecGenerations } from "@/lib/spec";
import { SpecReviewer } from "./client";

export const dynamic = "force-dynamic";

/**
 * 차종별 순정 제원 검수 (D-04 3차 개정, 2026-09-03)
 *
 *   사장님 요청: 「순정 제원… 정보는 철저한 검증을 통해서 할루시네이션을 방지하는 등의
 *   여러 조치가 취해져야함」 / 「출처가 약한 값들은 교차 검증을 통해 철저히 검증 후
 *   알려줬으면 좋겠음. 그러면 내가 한번더 검수하겠음.」
 *
 * 🔴 이 화면의 핵심은 **값 옆에 원문이 같이 있다**는 것이다.
 *    값만 보여 주고 「맞나요?」라고 물으면 검수가 아니라 찍기가 된다.
 *    제조사 페이지에서 그대로 옮긴 줄을 나란히 놓고, 주소도 눌러 볼 수 있게 둔다.
 *
 * 🔴 휠너트 토크·엔진오일 용량은 **승인 전에 숫자가 아예 안 온다** (lib/spec.ts).
 *    검수 화면에서만 원문 줄로 확인하고 누르시는 구조다.
 */
export default async function SpecSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gen?: string }>;
}) {
  const sp = await searchParams;
  const can = await hasPerm("master");

  return (
    <PageShell width="md">
      <PageHeader title="차종별 순정 제원" back={{ href: "/settings", label: "설정" }} />
      <p className="mt-1 text-sm text-slate-500">
        제조사 취급설명서에서 그대로 옮겨 온 값입니다. <strong>원문과 나란히 보고</strong> 맞으면 눌러 주세요.
      </p>

      {!can ? (
        <Notice tone="warn">제원 검수는 사장님 계정에서만 할 수 있습니다.</Notice>
      ) : (
        <Body gen={sp.gen} />
      )}
    </PageShell>
  );
}

async function Body({ gen }: { gen?: string }) {
  const rows = await listSpecGenerations();
  const review = gen ? await getSpecReview(gen) : null;
  if (gen && !review) {
    return (
      <Notice tone="error">
        「{gen}」 차종을 못 찾았습니다.{" "}
        <Link href="/settings/spec" className="underline">
          목록으로
        </Link>
      </Notice>
    );
  }
  return <SpecReviewer rows={rows} review={review} />;
}
