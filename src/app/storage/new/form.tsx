"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ListRow } from "@/components/ui/list-row";
import { searchVehicles } from "@/lib/search-actions";
import type { VehicleHit } from "@/lib/search";
import { registerStorage } from "@/lib/tire-storage";
import { formatStorageNo, sizeHints, suggestDropKind, type StorageDropInput } from "@/lib/tire-storage-pure";
import { DropFields, emptyDrop } from "../drop-fields";

export function RegisterForm({
  initial,
  existing,
  today,
}: {
  initial: VehicleHit | null;
  existing: { id: number; no: number | null; describe: string }[];
  today: string;
}) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState<VehicleHit | null>(initial);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VehicleHit[] | null>(null);
  const [drop, setDrop] = useState<StorageDropInput>(() =>
    emptyDrop(suggestDropKind({ month: Number(today.slice(5, 7)) }), initial?.lastFittedSize ?? ""),
  );
  const [storedOn, setStoredOn] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!vehicle) {
    return (
      <div className="mt-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            start(async () => setHits(await searchVehicles(q)));
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="차량번호 · 끝 4자리 · 전화 · 이름"
            className="min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-4 py-3 text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
          />
          <Button type="submit" pending={pending} aria-label="찾기" className="w-12 !px-0">
            <Search className="size-5" />
          </Button>
        </form>
        {hits && hits.length === 0 && (
          <Notice tone="info">찾는 차가 없습니다 — 처음 오신 손님이면 판매 등록 화면에서 손님·차량을 먼저 등록해 주세요.</Notice>
        )}
        <div className="mt-2 divide-y divide-slate-100">
          {hits?.map((h) => (
            <button
              key={h.vehicleId}
              type="button"
              className="block w-full text-left"
              onClick={() => {
                setVehicle(h);
                if (!drop.size && h.lastFittedSize) setDrop({ ...drop, size: h.lastFittedSize });
              }}
            >
              <ListRow title={`${h.plateNo} · ${h.customerName}`} sub={[h.makerName, h.model, h.lastFittedSize].filter(Boolean).join(" · ")} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-card bg-slate-50 p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {vehicle.plateNo} · {vehicle.customerName}
          </p>
          <p className="truncate text-sm text-slate-500">{[vehicle.makerName, vehicle.model].filter(Boolean).join(" ")}</p>
        </div>
        {!initial && (
          <Button variant="ghost" onClick={() => (setVehicle(null), setHits(null))}>
            바꾸기
          </Button>
        )}
      </div>

      {existing.length > 0 && (
        <Notice tone="warn">
          이 차는 이미 보관 중인 세트가 있습니다: {existing.map((e) => `#${formatStorageNo(e.no)} ${e.describe}`).join(" · ")}
        </Notice>
      )}

      <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(vehicle.lastFittedSize)} />

      <label className="flex items-center gap-2 text-sm text-slate-600">
        맡긴 날
        <input
          type="date"
          value={storedOn}
          max={today}
          onChange={(e) => setStoredOn(e.target.value)}
          className="tabular rounded-control border border-slate-300 bg-white px-3 py-2"
        />
      </label>

      {err && <Notice tone="error">{err}</Notice>}

      <Button
        size="lg"
        pending={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await registerStorage({ vehicleId: vehicle.vehicleId, drop, storedOn });
            if (r.ok) router.push(`/storage/${r.id}?new=1`);
            else setErr(r.error);
          })
        }
      >
        등록하고 보관번호 받기
      </Button>
      <p className="text-xs text-slate-400">보관료를 받으시면 판매 등록에서 「보관료」 줄을 넣어 주세요 — 여기서는 돈을 다루지 않습니다.</p>
    </div>
  );
}
