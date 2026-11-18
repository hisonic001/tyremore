import Link from "@/lib/link";
import { Package } from "lucide-react";
import { storageForVehicle } from "@/lib/tire-storage-data";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { shortDate } from "@/lib/tire-age";

/**
 * ⭐ 이 차(손님)의 보관 타이어 (D-42, 2026-11-17) — 보관 중이면 번호를 크게, 지난 것은 흐리게.
 */
export async function VehicleStorageBlock({ vehicleId, customerId }: { vehicleId: number; customerId: number }) {
  const rows = await storageForVehicle(vehicleId, customerId, true);
  const live = rows.filter((r) => r.status === "보관중");
  const past = rows.filter((r) => r.status !== "보관중").slice(0, 3);
  return (
    <section className="mt-5 rounded-card border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <Package className="size-4 text-slate-500" /> 보관 타이어
        </h2>
        <Link href={`/storage/new?vehicle=${vehicleId}`} className="rounded-control border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700">
          + 보관 등록
        </Link>
      </div>
      {live.length === 0 && <p className="mt-2 text-sm text-slate-500">지금 맡겨 둔 타이어가 없습니다.</p>}
      {live.map((r) => (
        <Link key={r.id} href={`/storage/${r.id}`} className="mt-2 flex items-center gap-3 rounded-control bg-brand-50 p-3">
          <span className="tabular text-2xl font-extrabold text-brand-700">{formatStorageNo(r.no)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{r.describe || "내용 없음"}</span>
            <span className="block text-xs text-slate-500">
              {r.areaName ? `📍${r.areaName} · ` : ""}
              {shortDate(r.storedOn)}부터{r.vehicleId !== vehicleId && r.plateNo ? ` · ${r.plateNo}에서 뺌` : ""}
            </span>
          </span>
        </Link>
      ))}
      {past.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
          {past.map((r) => (
            <li key={r.id}>
              <Link href={`/storage/${r.id}`} className="underline-offset-2 hover:underline">
                #{formatStorageNo(r.no)} {r.describe} · {r.status} {r.releasedOn ? shortDate(r.releasedOn) : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
