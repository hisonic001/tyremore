import { requirePerm } from "@/lib/auth";
import { batteryPriceTable } from "@/lib/battery-price";
import { PageShell, PageHeader } from "@/components/ui/page";
import { BatteryTable } from "./battery-table";

export const dynamic = "force-dynamic";

/**
 * ⭐ 배터리 단가표 (사장님 요청 2026-09-12 — "9월 인상된 단가표를 앱에서 볼 수 있었으면")
 *
 *   싸군배터리 단가표(사진)를 그대로 옮긴 순서로, **사 오는 값 · 파는 값 · 재고**를 한 화면에.
 *   사 오는 값은 단가표가 정본이라 여기서 못 고친다(`battery-price-list.ts` 를 고치고 스크립트).
 *   파는 값은 여기서 바로 적는다 — 적어 두면 판매 등록에서 저절로 채워진다.
 *
 * 🔴 정본 함수 하나(`batteryPriceTable`)만 부른다. 화면 인라인 SQL 없음.
 */
export default async function BatteryPricePage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  await requirePerm("stock");
  const { b } = await searchParams;
  const view = await batteryPriceTable();

  return (
    <PageShell width="lg">
      <PageHeader title="배터리 단가표" back={{ href: "/stock", label: "재고" }} />
      <BatteryTable view={view} initialBrand={b} />
    </PageShell>
  );
}
