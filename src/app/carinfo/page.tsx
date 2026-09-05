import Link from "@/lib/link";
import { requireSession } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { Notice } from "@/components/ui/notice";
import { listSpecGenerations } from "@/lib/spec";
import { guessGenerationByVin } from "@/lib/vin-learn";
import { looksLikeVin, parseVin } from "@/lib/vin";
import { CarLookup } from "./client";
import { specsForGeneration } from "@/lib/spec";
import { partsForGeneration } from "@/lib/parts-fit";
import { blogAgentStatus } from "@/lib/blog-job";

export const dynamic = "force-dynamic";

/**
 * 정비 조회 — 우리 손님이 아닌 차 (2026-09-04)
 *
 *   사장님 요청: 「차대번호 조회 혹은 차량번호와 소유주 이름으로 차량 정보를 확인하여
 *   타이어, 엔진오일, 와이퍼, 배터리 등의 OE 규격과 각종 차량 정비에 관련된 정보를
 *   확인하여 정비사의 편의를 돕는 것.」
 *
 * 🔴 **우리 손님 차는 이 화면이 아니다.** 홈에서 번호판·이름·차대번호로 찾으면
 *    차량 카드(`/vehicle/[id]`)가 나오고 거기 제원과 부품이 이미 붙는다.
 *    이 화면은 **아직 등록 안 된 차**를 위한 것이다.
 *
 * 🔴 **차대번호로 차종을 해독하지 못한다.** 확실한 것은 제조사와 연식뿐이다
 *    (lib/vin.ts 머리말 참조). 세대는 우리 차로 배운 지도가 **제안**만 하고,
 *    사장님이 맞다고 하시기 전에는 위험 값(휠너트 토크·오일 용량)의 숫자를 안 연다 —
 *    세대를 잘못 짚으면 다른 차의 토크가 뜨기 때문이다.
 */
export default async function CarInfoPage({
  searchParams,
}: {
  searchParams: Promise<{ vin?: string; gen?: string; ok?: string }>;
}) {
  await requireSession();
  const sp = await searchParams;
  const vinText = (sp.vin ?? "").trim();
  const vin = vinText && looksLikeVin(vinText) ? parseVin(vinText) : null;

  /* 세대: 사장님이 고른 것이 먼저, 없으면 차대번호로 제안 */
  const guess = !sp.gen && vin?.valid ? await guessGenerationByVin(vin.vin) : null;
  const variantKey = sp.gen ?? guess?.variantKey ?? null;
  /** 🔴 「제안」인지 「사장님이 고른 것」인지 — 위험 값을 여는 열쇠다 */
  const confirmed = Boolean(sp.gen) || sp.ok === "1";

  const gens = await listSpecGenerations();
  const spec = variantKey ? await specsForGeneration(variantKey, { confirmed }) : null;
  const parts = spec?.generationId ? await partsForGeneration(spec.generationId) : [];
  /* 🔴 사진은 매장 PC 가 읽는다 — 꺼져 있으면 누르기 전에 알려 준다 */
  const agent = await blogAgentStatus();

  return (
    <PageShell width="md">
      <PageHeader title="정비 조회" back={{ href: "/", label: "홈" }} />
      <p className="mt-1 text-sm text-slate-500">
        아직 등록 안 된 차의 순정 규격을 봅니다. <strong>우리 손님 차는 홈에서 번호판으로</strong> 찾으시면 됩니다.
      </p>

      {vinText && !vin && (
        <Notice tone="warn">차대번호는 영문·숫자 17자리입니다. 등록증에 적힌 대로 넣어 주세요.</Notice>
      )}

      <CarLookup
        vinText={vinText}
        vin={vin}
        guess={guess}
        confirmed={confirmed}
        spec={spec}
        parts={parts}
        gens={gens.map((g) => ({ variantKey: g.variantKey, label: g.label }))}
        agent={agent}
      />

      <p className="mt-6 text-[11px] leading-snug text-slate-400">
        순정 규격은 제조사 취급설명서에서 그대로 옮긴 값이고, 부품은 우리 상품의 적용 차종 글자가
        이 차종과 맞는 것만 보여 줍니다. 실제 차에 붙은 타이어·휠이 순정과 다를 수 있으니
        <strong> 운전석 문틀 라벨</strong>도 함께 봐 주세요.{" "}
        <Link href="/settings/spec" className="underline underline-offset-2">
          제원 검수
        </Link>
      </p>
    </PageShell>
  );
}
