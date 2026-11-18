import { notFound } from "next/navigation";
import { requireStoragePerm } from "@/lib/auth";
import { listAreas } from "@/lib/tire-storage-data";
import { slotsOf } from "@/lib/storage-plan-pure";
import { toPlan } from "@/app/storage/plan/plan-canvas";
import { SignSheet } from "./sheet";

export const dynamic = "force-dynamic";

/**
 * ⭐ 자리 표지 (2026-11-18 3차) — 구역 도면의 자리 이름을 A4 한 장에 하나씩 크게. 벽·선반에 붙인다.
 *   화면의 「흰색 창고 › 안쪽 2」와 창고 벽의 글자가 같아야 찾는 사람이 헤매지 않는다.
 */
export default async function SignsPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  await requireStoragePerm();
  const sp = await searchParams;
  const area = (await listAreas()).find((a) => a.id === Number(sp.area) && !a.isSite);
  if (!area) notFound();
  const slots = slotsOf(toPlan(area.plan)).map((s, i) => s.label.trim() || `칸 ${i + 1}`);
  return <SignSheet areaName={area.name} slots={slots} />;
}
