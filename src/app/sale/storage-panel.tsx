"use client";

import { useEffect, useState } from "react";
import type { VehicleHit } from "@/lib/search";
import { findStoredSets } from "@/lib/tire-storage";
import type { StorageRow } from "@/lib/tire-storage-data";
import { parseTireAttrs } from "@/lib/tire-attrs";
import { formatStorageNo, suggestDropKind, type SaleStorageInput } from "@/lib/tire-storage-pure";
import { DropFields, emptyDrop } from "../storage/drop-fields";

export const EMPTY_SALE_STORAGE: SaleStorageInput = { drops: [], pickupIds: [] };

/**
 * ⭐ 판매 화면의 「타이어 보관」 칸 (D-42, 2026-11-17)
 *
 *   차를 고르면 그 차에 맡겨 둔 세트가 뜬다 → 「오늘 찾아감」 체크(꺼내 끼움).
 *   「+ 맡긴 타이어」로 오늘 빼서 맡기는 세트를 적는다 → 저장하면 보관번호가 나오고 스티커를 뽑는다.
 *   예약 판매(아직 시공 전)·차 없는 판매에는 안 나온다.
 *   🔴 판매 화면(client.tsx)은 이 칸의 값만 들고 있다 — 규칙은 tire-storage-pure, 저장은 saveSale 트랜잭션.
 */
export function StoragePanel({
  vehicle,
  reserve,
  rows,
  value,
  onChange,
}: {
  vehicle: VehicleHit | null;
  reserve: boolean;
  rows: { kind: string; description: string; spec?: string | null }[];
  value: SaleStorageInput;
  onChange: (v: SaleStorageInput) => void;
}) {
  const [sets, setSets] = useState<StorageRow[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!vehicle) return setSets([]);
    let alive = true;
    void findStoredSets(vehicle.vehicleId, vehicle.customerId)
      .then((r) => {
        if (!alive) return;
        setSets(r);
        // 다른 차로 바꾸면 그 차 세트가 아닌 체크는 내린다
        const ids = new Set(r.map((x) => x.id));
        if (value.pickupIds.some((id) => !ids.has(id))) onChange({ ...value, pickupIds: value.pickupIds.filter((id) => ids.has(id)) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.vehicleId]);

  if (!vehicle) return null;
  if (reserve) {
    return value.drops.length || value.pickupIds.length ? (
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">📦 예약 판매에는 보관을 적지 않습니다 — 시공한 날 보관 화면에서 등록해 주세요.</p>
    ) : null;
  }

  const firstSpec = rows.find((r) => r.kind === "tire" && r.spec)?.spec ?? "";
  const mounted = rows.filter((r) => r.kind === "tire").map((r) => parseTireAttrs(r.description, r.description).season);
  const pickedKinds = sets.filter((s) => value.pickupIds.includes(s.id)).map((s) => s.kind);
  const addDrop = () => {
    const kind = suggestDropKind({ pickupKinds: pickedKinds, mountedSeasons: mounted, month: new Date().getMonth() + 1 });
    onChange({ ...value, drops: [...value.drops, emptyDrop(kind, firstSpec || vehicle.lastFittedSize || "")] });
    setOpen(true);
  };
  const showBody = open || sets.length > 0 || value.drops.length > 0;

  return (
    <section className="rounded-xl border border-slate-300 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left text-sm font-bold text-slate-800">
          📦 타이어 보관
          <span className="ml-1 font-normal text-slate-500">
            {sets.length ? `맡겨 둔 세트 ${sets.length}` : "맡겨 둔 세트 없음"}
            {value.drops.length ? ` · 오늘 맡김 ${value.drops.length}` : ""}
          </span>
        </button>
        <button type="button" onClick={addDrop} className="rounded-control border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-100">
          + 맡긴 타이어
        </button>
      </div>

      {showBody && (
        <div className="mt-2 space-y-2">
          {sets.map((s) => {
            const on = value.pickupIds.includes(s.id);
            return (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded-control border p-3 ${on ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-slate-50"}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    onChange({ ...value, pickupIds: e.target.checked ? [...value.pickupIds, s.id] : value.pickupIds.filter((id) => id !== s.id) })
                  }
                  className="size-5 accent-brand-600"
                />
                <span className="tabular text-xl font-extrabold">{formatStorageNo(s.no)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.describe || "내용 없음"}</span>
                  <span className="block text-xs text-slate-500">
                    {s.storedOn}부터 보관 {on ? "→ 오늘 찾아감(꺼내 끼움)" : "· 꺼내 끼우면 체크"}
                  </span>
                </span>
              </label>
            );
          })}

          {value.drops.map((d, i) => (
            <div key={i} className="rounded-control border border-dashed border-slate-300 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">오늘 맡기는 타이어 {value.drops.length > 1 ? i + 1 : ""}</span>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, drops: value.drops.filter((_, j) => j !== i) })}
                  className="px-1 text-sm text-slate-400 active:text-red-600"
                >
                  빼기 ✕
                </button>
              </div>
              <DropFields value={d} onChange={(nd) => onChange({ ...value, drops: value.drops.map((x, j) => (j === i ? nd : x)) })} />
            </div>
          ))}
          {value.drops.length > 0 && (
            <p className="text-xs text-slate-500">저장하면 보관번호가 나옵니다 — 스티커를 뽑아 붙여 주세요. 보관료를 받으면 공임에 「보관료」를 넣으세요.</p>
          )}
        </div>
      )}
    </section>
  );
}
