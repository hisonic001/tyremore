import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/app-setting";
import { labelRows } from "@/lib/tire-storage-data";
import { LABEL_PAPER_KEY, LABEL_SIZE_KEY, parseLabelPaper, parseLabelSize } from "@/lib/tire-storage-pure";
import { formatPhone } from "@/lib/normalize";
import { LabelSheet } from "./label";

export const dynamic = "force-dynamic";

/**
 * ⭐ 보관 스티커 (D-03 → D-42) — ?ids=1,2,3
 *
 *   내용 (사장님 2026-11-17): 보관번호 · 일반/윈터 · 차번호 · 이름 · 전화번호 · 타이어 · 사이즈 · 갯수 · 보관날짜.
 *   용지 (사장님 2026-11-17 「일반 프린터로도」): 기본 **A4 한 장에 8개**(잘라 붙임) · 라벨프린터는 한 장에 하나.
 *   바코드 없음(D-11). AppNav 는 /print/* 에서 숨는다.
 */
export default async function StorageLabelPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requirePerm("sale");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map(Number);
  const rows = await labelRows(ids);
  const size = parseLabelSize(await getSetting(LABEL_SIZE_KEY));
  const paper = parseLabelPaper(await getSetting(LABEL_PAPER_KEY));
  return (
    <LabelSheet
      size={size}
      paper={paper}
      labels={rows.map((r) => ({
        id: r.id,
        no: r.no!,
        kind: r.kind,
        plate: r.plateNo,
        owner: r.ownerName,
        phone: r.phone ? formatPhone(r.phone) : null,
        brand: r.brand,
        size: r.size,
        qty: r.qty,
        storedOn: r.storedOn,
      }))}
    />
  );
}
