"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDotQty } from "@/lib/stock";

/**
 * ⭐ 화면에서 바로 수량 고치기 (사장님 지시 2026-08-04)
 *
 *   "재고 변경이 엑셀로만 되는 점이 불편함."
 *
 * 🔴 2026-08-03 의 「엑셀로만 고친다」 지시가 **뒤집혔다.** 알고 뒤집는다 —
 *    한두 줄 고치자고 엑셀을 내려받아 다시 올리는 것이 실사용에서 더 불편했다.
 *    엑셀은 **여러 상품을 한꺼번에** 맞출 때(전수 실사)의 길로 그대로 남는다.
 *
 * 서버 쪽 `setDotQty` 는 처음부터 있었다(실사 반영용). 화면만 없었을 뿐이다.
 * 「이 DOT 는 실제로 몇 본이더라」를 그대로 치면 조정 이력까지 남는다.
 */
export function QtyEditor({
  productId,
  dot,
  qty,
  unit,
}: {
  productId: number;
  dot: string | null;
  qty: number;
  unit: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(qty));
  const [error, setError] = useState<string | null>(null);

  function save() {
    const n = Number(value);
    start(async () => {
      setError(null);
      const r = await setDotQty({ productId, dot, qty: n, reason: "실사조정" });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(qty));
          setEditing(true);
        }}
        className="tabular rounded-lg px-2 py-1 text-2xl font-bold active:bg-slate-100"
        aria-label="수량 고치기"
      >
        {qty}
        <span className="ml-0.5 text-sm font-medium text-slate-500">{unit}</span>
        <span className="ml-1.5 align-middle text-sm text-slate-400">✏️</span>
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="tabular w-20 rounded-lg border-2 border-slate-900 px-2 py-1.5 text-right text-xl font-bold outline-none"
      />
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        저장
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-lg px-2 py-2 text-sm text-slate-500"
      >
        취소
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/** DOT 를 새로 추가하며 수량을 넣는다 — 실물엔 있는데 화면에 줄이 없을 때 */
export function AddDotRow({ productId }: { productId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [dot, setDot] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    start(async () => {
      setError(null);
      const r = await setDotQty({
        productId,
        dot: dot.trim() || null,
        qty: Number(qty),
        reason: "실사조정",
      });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      setDot("");
      setQty("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 active:bg-slate-50"
      >
        + 다른 DOT 추가
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <div className="flex gap-2">
        <input
          value={dot}
          onChange={(e) => setDot(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="DOT (예: 1826)"
          inputMode="numeric"
          className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5"
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          placeholder="수량"
          inputMode="numeric"
          className="tabular w-20 rounded-lg border border-slate-300 px-3 py-2.5 text-right"
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">DOT 를 모르면 비워 두세요 — 「DOT 없음」 줄로 들어갑니다</p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending || !qty}
          onClick={save}
          className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          추가
        </button>
      </div>
    </div>
  );
}
