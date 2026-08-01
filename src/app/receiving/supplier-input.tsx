"use client";

import { useEffect, useRef, useState } from "react";
import { supplierList } from "@/lib/invoice";

/**
 * ⭐ 거래처 고르기 (사장님 요청 2026-08-01)
 *
 * > "쌍성 타이어인데 누가 쌍성으로 또 다른 거래처를 만들어 놓으면 곤란하잖아"
 *
 * 치는 동안 이미 쓴 거래처를 보여준다. 공백을 무시하고 찾으므로
 * 「쌍성」으로 「쌍성 타이어」가 나온다.
 * 비슷한 이름이 있는데 새로 만들려 하면 **한 번 더 묻는다.**
 */
export function SupplierInput({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
}) {
  const [hits, setHits] = useState<{ name: string; count: number; lastAt: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setHits(await supplierList(value));
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value]);

  const typed = value.replace(/\s/g, "").toLowerCase();
  /** 이미 있는 이름과 완전히 같은가 */
  const exact = hits.some((h) => h.name.replace(/\s/g, "").toLowerCase() === typed);
  /** 비슷한 이름이 있는데 새로 만들려는 상황 */
  const similar = !exact && typed.length >= 2 && hits.length > 0;

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="거래처 이름"
        autoComplete="off"
        className="w-full rounded-lg border-2 border-slate-300 px-3 py-3 text-lg outline-none focus:border-slate-900"
      />

      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg">
          {hits.map((h) => (
            <li key={h.name}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(h.name);
                  onPick?.(h.name);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left active:bg-slate-100"
              >
                <span className="truncate font-medium">{h.name}</span>
                <span className="tabular shrink-0 text-xs text-slate-400">
                  {h.count}건 {h.lastAt && `· ${h.lastAt}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ⚠️ 같은 거래처가 두 이름으로 갈리면 매입 내역을 나중에 못 합친다 */}
      {similar && (
        <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          비슷한 거래처가 있습니다 — <strong>{hits[0].name}</strong>. 같은 곳이면 위에서 골라 주세요.
        </p>
      )}
      {exact && <p className="mt-1 text-xs text-emerald-700">이미 쓰던 거래처입니다</p>}
    </div>
  );
}
