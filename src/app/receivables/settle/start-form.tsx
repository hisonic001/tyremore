"use client";

/** 정산 시작 — 거래처와 달을 골라 회차를 만든다 (있으면 그 회차로 들어간다) */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startSettlement } from "@/lib/settlement";

export function StartForm({
  candidates,
  defaultYm,
}: {
  candidates: { name: string; n: number; recentYm: string }[];
  defaultYm: string;
}) {
  const router = useRouter();
  const [supplier, setSupplier] = useState(candidates[0]?.name ?? "");
  const [ym, setYm] = useState(defaultYm);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = () =>
    start(async () => {
      setErr(null);
      const r = await startSettlement(supplier, ym);
      if (!r.ok) return setErr(r.error);
      router.push(`/receivables/settle/${encodeURIComponent(supplier)}?ym=${ym}`);
    });

  return (
    <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-3 text-sm"
        >
          {candidates.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} (외상 {c.n}건)
            </option>
          ))}
        </select>
        <input
          type="month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="tabular min-h-11 rounded-control border border-slate-300 bg-white px-3 text-sm"
        />
        <button
          type="button"
          disabled={pending || !supplier}
          onClick={go}
          className="min-h-11 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "여는 중…" : "정산 열기"}
        </button>
      </div>
      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}
