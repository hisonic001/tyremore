"use client";

import { useState } from "react";
import type { AreaInfo, PinRow, StorageRow } from "@/lib/tire-storage-data";
import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import { LocationSection } from "./location-section";

/**
 * ⭐ 붙이기 모드 (2026-11-18) — 위치 없는 보관중 세트를 번호 순으로. 스티커를 붙이면서 「📍 위치 찍기」 한 번씩.
 *   타이어를 다시 쌓지 않아도 된다 — 지금 놓인 자리를 도면에 찍는다(섞인 더미는 같은 점에 붙인다).
 */
export function PlaceList({ rows, areas, pins }: { rows: StorageRow[]; areas: AreaInfo[]; pins: PinRow[] }) {
  const [done, setDone] = useState<number[]>([]);
  const left = rows.filter((r) => !done.includes(r.id));
  return (
    <div className="mt-2">
      <p className="text-sm text-slate-600">
        위치 안 찍은 세트 <strong className="text-slate-900">{left.length}</strong>개 · 번호 순 — 스티커 붙이며 하나씩 찍으세요.
      </p>
      <div className="mt-2 divide-y divide-slate-100">
        {left.map((r) => (
          <div key={r.id} className="py-3">
            <div className="flex items-center gap-3">
              <span className="tabular text-3xl font-extrabold">{formatStorageNo(r.no)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {r.plateNo ?? "차량 없음"} · {r.ownerName}
                </span>
                <span className="block truncate text-sm text-slate-500">
                  {labelKind(r.kind)} · {[r.brand, r.size, `${r.qty}본`].filter(Boolean).join(" ")}
                </span>
              </span>
            </div>
            <LocationSection
              id={r.id}
              areaId={null}
              x={null}
              y={null}
              areas={areas}
              pins={pins}
              compact
              onDone={() => setDone((d) => [...d, r.id])}
            />
          </div>
        ))}
      </div>
      {left.length === 0 && <p className="mt-6 text-center text-slate-500">✅ 모든 세트에 위치를 찍었습니다</p>}
    </div>
  );
}
