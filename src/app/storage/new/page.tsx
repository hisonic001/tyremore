import { requirePerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { vehicleHitById } from "@/lib/search";
import { storageForVehicle } from "@/lib/tire-storage-data";
import { RegisterForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * ⭐ 판매 없이 맡김 등록 (D-42) — 차량 화면 「보관 등록」 · 실사에서 메모 없이 찾은 세트.
 *   교체 작업과 함께 맡기면 판매 등록 화면의 「맡긴 타이어」가 더 빠르다.
 */
export default async function NewStoragePage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  await requirePerm("sale");
  const sp = await searchParams;
  const vid = Number(sp.vehicle);
  const hit = Number.isInteger(vid) && vid > 0 ? await vehicleHitById(vid) : null;
  const existing = hit ? await storageForVehicle(hit.vehicleId, hit.customerId) : [];
  return (
    <PageShell>
      <PageHeader title="맡김 등록" back={hit ? { href: `/vehicle/${hit.vehicleId}`, label: "차량" } : { href: "/storage", label: "보관 목록" }} />
      <RegisterForm
        initial={hit}
        existing={existing.map((e) => ({ id: e.id, no: e.no, describe: e.describe }))}
        today={new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}
      />
    </PageShell>
  );
}
