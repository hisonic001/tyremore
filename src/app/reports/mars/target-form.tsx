"use client";

/**
 * 분기 미쉐린 타겟 수량 입력 — 사장님만 (2026-08-10)
 * 본사가 분기마다 정해 주는 숫자라 자동으로 알 수 없다. 여기 넣으면
 * 평가표 Ⅰ-1 「등록 비율 = 등록 수량 ÷ 타겟」이 계산된다.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMarsQuarterTarget } from "@/lib/mars-eval";

export function TargetForm({ year, quarter, target }: { year: number; quarter: number; target: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(target === null);
  const [v, setV] = useState(target === null ? "" : String(target));
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 underline underline-offset-2"
      >
        타겟 고치기
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        placeholder="본사가 알려준 분기 타겟 본수"
        className="tabular w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
      />
      <button
        type="button"
        disabled={pending || v === ""}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await setMarsQuarterTarget(year, quarter, Number(v));
            if (!r.ok) return setMsg(`⚠️ ${r.error}`);
            setOpen(false);
            router.refresh();
          })
        }
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "저장 중…" : "타겟 저장"}
      </button>
      {msg && <span className="text-sm text-red-600">{msg}</span>}
    </div>
  );
}
