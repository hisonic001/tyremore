import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/app-setting";
import { labelRows } from "@/lib/tire-storage-data";
import { LABEL_SIZE_KEY, parseLabelSize } from "@/lib/tire-storage-pure";
import { LabelSheet } from "./label";

export const dynamic = "force-dynamic";

/**
 * ⭐ 보관 스티커 (D-03 → D-42, 2026-11-17) — 라벨프린터로 한 세트에 한 장.
 *   ?ids=1,2,3 · 크기는 app_setting 「storage_label_size」(기본 62x40mm, 화면에서 바꿈).
 *   바코드 없음(D-11에서 접었다) — 번호를 크게. 번호가 곧 창고 자리다.
 *   AppNav 는 /print/* 에서 숨는다.
 */
export default async function StorageLabelPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requirePerm("sale");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map(Number);
  const rows = await labelRows(ids);
  const size = parseLabelSize(await getSetting(LABEL_SIZE_KEY));
  return (
    <LabelSheet
      size={size}
      labels={rows.map((r) => ({
        id: r.id,
        no: r.no!,
        kind: r.kind,
        plate: r.plateNo,
        owner: r.ownerName,
        describe: [r.brand, r.size].filter(Boolean).join(" "),
        qty: r.qty,
        storedOn: r.storedOn,
      }))}
    />
  );
}
