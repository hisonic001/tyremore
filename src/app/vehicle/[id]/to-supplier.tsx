"use client";

/**
 * ⭐ 차량을 거래처 차고로 보내기 (사장님 요청 2026-09-02 — 거래처 화면 개편).
 *    거래처 카드의 「가져오기」와 같은 정본(moveVehicleToSupplier) — 사장님 전용.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveVehicleToSupplier } from "@/lib/customer-edit";

export function ToSupplier({ vehicleId, plateNo, suppliers }: { vehicleId: number; plateNo: string; suppliers: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (msg) return <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">{msg}</p>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-slate-400 underline underline-offset-4"
      >
        이 차량을 거래처 차고로 보내기
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50 p-3">
      <p className="text-sm font-medium text-violet-900">{plateNo} 을(를) 어느 거래처 차량으로 보낼까요?</p>
      <p className="mt-0.5 text-xs text-violet-700">정비 이력은 차량에 그대로 따라가고, 지난 외상의 주인은 안 바뀝니다.</p>
      <div className="mt-2 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          list="active-suppliers"
          placeholder="거래처 이름"
          className="min-w-0 flex-1 rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm"
        />
        <datalist id="active-suppliers">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await moveVehicleToSupplier(vehicleId, name.trim());
              if (!r.ok) return setErr(r.error);
              setMsg(`「${name.trim()}」 차량으로 보냈습니다 (${r.from} → 거래처)`);
              router.refresh();
            })
          }
          className="shrink-0 rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          보내기
        </button>
        <button type="button" onClick={() => setOpen(false)} className="shrink-0 px-1 text-xs text-slate-500">
          취소
        </button>
      </div>
      {err && <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">{err}</p>}
    </div>
  );
}
