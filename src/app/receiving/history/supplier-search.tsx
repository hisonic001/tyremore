"use client";

/**
 * ⭐ 매입 내역 거래처 검색창 (사장님 결정 2026-08-29)
 *
 *   "기간 브랜드는 펼쳐둔다. 거래처는 검색으로 정할 수 있도록 검색창만."
 *
 *   거래처는 15곳이 넘어 칩으로 깔면 그 자체가 화면을 또 길게 만든다.
 *   후보는 **그 기간에 실제로 매입한 곳**만 받아 쓴다 —
 *   `supplierList()` 는 자동완성용으로 8곳에서 잘려(invoice.ts:861) 여기 맞지 않는다.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

export function SupplierSearch({
  value,
  options,
  keep,
}: {
  /** 지금 고른 거래처 (없으면 null) */
  value: string | null;
  /** 그 기간에 매입한 거래처 — { 이름, 수량, 단위 } */
  options: { key: string; label: string; qty: number; unit: string }[];
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const go = (supplier: string | undefined) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, supplier })) if (v) p.set(k, v);
    setOpen(false);
    setQ("");
    router.push(`/receiving/history${p.toString() ? `?${p.toString()}` : ""}`);
  };

  const key = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const hits = q.trim() ? options.filter((o) => key(o.label).includes(key(q))) : options;

  if (value) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => go(undefined)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-medium text-white"
        >
          거래처 · {value}
          <X className="size-4 text-slate-300" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative mt-2">
      <div className="flex items-center gap-2 rounded-control border border-slate-300 bg-white px-3">
        <Search className="size-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={`거래처로 좁히기 (${options.length}곳)`}
          className="min-h-11 w-full bg-transparent text-sm outline-none"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="shrink-0 text-slate-400">
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-slate-200 bg-white shadow-card">
          {hits.slice(0, 12).map((o) => (
            <li key={o.key}>
              <button
                type="button"
                onClick={() => go(o.label)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-sm active:bg-slate-50 lg:hover:bg-slate-50"
              >
                <span className="truncate">{o.label}</span>
                <span className="tabular shrink-0 text-xs text-slate-500">
                  {o.qty}
                  {o.unit}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
