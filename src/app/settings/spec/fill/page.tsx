import { hasPerm } from "@/lib/auth";
import { Notice } from "@/components/ui/notice";
import { PageHeader, PageShell } from "@/components/ui/page";
import { fillTargets, getFillSheet } from "@/lib/spec-entry";
import { FillUI } from "./client";

export const dynamic = "force-dynamic";

/**
 * 제원 채우기 — 사장님이 직접 넣으시는 화면 (2026-09-08)
 *
 * 「니가 폼을 만들어주면 내가 찾아서 넣어볼게.」
 *
 * 🔴 **왜 이 화면이 필요한가** — 설명서를 인터넷에서 받을 수 있는 차종이 다 떨어졌다.
 *    기아는 현행 연식만 올리고, 현대 자료실에는 제원 없는 120세대 중 둘뿐이며,
 *    통합 설명서는 딜러 로그인이 필요하다. 남은 길은 사람이 보고 넣는 것뿐이다.
 *
 * 🔴 **하루에 한 차종이면 된다.** 무엇부터 할지 고르시게 하면 사흘 만에 멈춘다 —
 *    손님 차가 많고 빈칸이 많은 차종을 하나 골라 「오늘 것」으로 내민다.
 */
export default async function SpecFillPage({
  searchParams,
}: {
  searchParams: Promise<{ gen?: string }>;
}) {
  const sp = await searchParams;
  const can = await hasPerm("master");

  return (
    <PageShell width="md">
      <PageHeader title="제원 채우기" back={{ href: "/settings/spec", label: "순정 제원" }} />
      <p className="mt-1 text-sm text-slate-500">
        보신 대로 치시면 <strong>저장될 모양을 바로 보여 드립니다</strong>. 표기는 저희가 맞춥니다.
      </p>

      {!can ? <Notice tone="warn">제원 입력은 사장님 계정에서만 됩니다.</Notice> : <Body gen={sp.gen} />}
    </PageShell>
  );
}

async function Body({ gen }: { gen?: string }) {
  /* 🔴 질의는 순차로 — Promise.all 로 묶으면 풀이 만석이 된다 (2026-08-11 사고) */
  const targets = await fillTargets();
  const pick = gen ?? targets[0]?.variantKey;
  if (!pick) return <Notice tone="success">채울 것이 없습니다 — 모든 차종이 다 찼습니다.</Notice>;

  const sheet = await getFillSheet(pick);
  if (!sheet) return <Notice tone="error">「{pick}」 차종을 못 찾았습니다.</Notice>;

  return <FillUI sheet={sheet} targets={targets} />;
}
