import { requirePerm } from "@/lib/auth";
import { getSetting } from "@/lib/app-setting";
import { labelRows, labelRowsByRange } from "@/lib/tire-storage-data";
import { LABEL_PAPER_KEY, LABEL_PER_KEY, LABEL_SIZE_KEY, parseLabelPaper, parseLabelPer, parseLabelSize } from "@/lib/tire-storage-pure";
import { formatPhone } from "@/lib/normalize";
import { LabelSheet } from "./label";

export const dynamic = "force-dynamic";

/**
 * ⭐ 보관 스티커 (D-03 → D-42) — ?ids=1,2,3 또는 ?from=4&to=55 (번호 범위, 2026-11-18)
 *
 *   내용 (사장님 2026-11-17): 보관번호 · 일반/윈터 · 차번호 · 이름 · 전화번호 · 타이어 · 사이즈 · 갯수 · 보관날짜 (+ 구역).
 *   용지: 기본 일반 프린터 A4. **기본 타이어마다 한 장(A4 24칸)** — 섞인 더미 때문(사장님 11-18). 한 세트 한 장(A4 8칸)도 고를 수 있다.
 *   바코드 없음(D-11). AppNav 는 /print/* 에서 숨는다.
 */
export default async function StorageLabelPage({ searchParams }: { searchParams: Promise<{ ids?: string; from?: string; to?: string }> }) {
  await requirePerm("sale");
  const sp = await searchParams;
  const from = Number(sp.from);
  const to = Number(sp.to);
  const rows =
    Number.isInteger(from) && from > 0
      ? await labelRowsByRange(from, Number.isInteger(to) && to > 0 ? to : from)
      : await labelRows((sp.ids ?? "").split(",").map(Number));
  const size = parseLabelSize(await getSetting(LABEL_SIZE_KEY));
  const paper = parseLabelPaper(await getSetting(LABEL_PAPER_KEY));
  const per = parseLabelPer(await getSetting(LABEL_PER_KEY));
  return (
    <LabelSheet
      size={size}
      paper={paper}
      per={per}
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
        area: r.areaName,
      }))}
    />
  );
}
