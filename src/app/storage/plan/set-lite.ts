import type { StorageRow } from "@/lib/tire-storage-data";
import type { SetLite } from "./location";

/** 서버 줄 → 화면용 가벼운 세트 (창고 실사·위치 고르기·찾기) */
export function toSetLite(r: StorageRow): SetLite {
  return {
    id: r.id,
    no: r.no,
    status: r.status,
    plate: r.plateNo,
    owner: r.ownerName,
    describe: [r.brand, r.size, `${r.qty}본`].filter(Boolean).join(" "),
    kind: r.kind,
    qty: r.qty,
    areaId: r.areaId,
    slotId: r.slotId,
    stackNo: r.stackNo,
  };
}
