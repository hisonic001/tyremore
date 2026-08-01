"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProductActive } from "@/lib/catalog";
import { changeDot, setDotQty } from "@/lib/stock";

/** 현장에서 장갑 낀 손으로 누른다. 버튼을 크게. */
const BTN = "h-12 w-12 shrink-0 rounded-xl border border-slate-300 bg-white text-2xl font-bold active:bg-slate-100 disabled:opacity-40";

export function DotRow({
  productId,
  dot,
  qty,
  unit,
  serialized,
}: {
  productId: number;
  dot: string | null;
  qty: number;
  unit: string;
  serialized: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(qty);
  const [dotValue, setDotValue] = useState(dot ?? "");
  const [editingDot, setEditingDot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== qty;

  function save() {
    setError(null);
    start(async () => {
      const r = await setDotQty({ productId, dot, qty: value, reason: "실사조정" });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function saveDot() {
    setError(null);
    start(async () => {
      const r = await changeDot({ productId, fromDot: dot, toDot: dotValue || null });
      if (!r.ok) setError(r.error);
      else {
        setEditingDot(false);
        router.refresh();
      }
    });
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-3">
        {serialized && (
          <div className="w-32 shrink-0">
            {editingDot ? (
              <div className="flex gap-1">
                <input
                  value={dotValue}
                  onChange={(e) => setDotValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="1826"
                  inputMode="numeric"
                  className="tabular w-20 rounded-lg border-2 border-slate-900 px-2 py-1.5 text-lg"
                />
                <button onClick={saveDot} disabled={pending} className="rounded-lg bg-slate-900 px-2 text-sm text-white">
                  저장
                </button>
              </div>
            ) : (
              <button onClick={() => setEditingDot(true)} className="text-left">
                <span className="tabular text-lg font-semibold">
                  {dot ?? <span className="font-normal text-amber-600">DOT 없음</span>}
                </span>
                <span className="ml-1 text-xs text-slate-400">✏️</span>
                {dot && <div className="text-xs text-slate-500">{dotLabel(dot)}</div>}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-1 items-center justify-end gap-2">
          <button className={BTN} onClick={() => setValue((v) => Math.max(0, v - 1))} disabled={pending}>
            −
          </button>
          <input
            value={value}
            onChange={(e) => setValue(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
            inputMode="numeric"
            className="tabular h-12 w-16 rounded-xl border border-slate-300 text-center text-2xl font-bold"
          />
          <span className="w-5 text-slate-500">{unit}</span>
          <button className={BTN} onClick={() => setValue((v) => v + 1)} disabled={pending}>
            +
          </button>
        </div>
      </div>

      {(dirty || error) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-sm text-red-600">{error}</span>
          {dirty && (
            <div className="flex gap-2">
              <button onClick={() => setValue(qty)} className="rounded-lg px-3 py-2 text-sm text-slate-500">
                되돌리기
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-lg bg-slate-900 px-5 py-2 font-medium text-white disabled:opacity-50"
              >
                {pending ? "저장 중…" : `${qty} → ${value} 확정`}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function NewDotRow({
  productId,
  unit,
  serialized,
}: {
  productId: number;
  unit: string;
  serialized: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [dot, setDot] = useState("");
  const [qty, setQty] = useState(4);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 py-4 font-medium text-slate-600 active:bg-slate-100"
      >
        + 재고 넣기
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-slate-900 bg-white p-4">
      <div className="flex items-center gap-3">
        {serialized && (
          <div className="w-32 shrink-0">
            <label className="block text-xs text-slate-500">DOT (모르면 비워두세요)</label>
            <input
              value={dot}
              onChange={(e) => setDot(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1826"
              inputMode="numeric"
              autoFocus
              className="tabular mt-1 w-24 rounded-lg border border-slate-300 px-2 py-2 text-lg"
            />
          </div>
        )}
        <div className="flex flex-1 items-center justify-end gap-2">
          <button className={BTN} onClick={() => setQty((v) => Math.max(1, v - 1))}>
            −
          </button>
          <input
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
            inputMode="numeric"
            className="tabular h-12 w-16 rounded-xl border border-slate-300 text-center text-2xl font-bold"
          />
          <span className="w-5 text-slate-500">{unit}</span>
          <button className={BTN} onClick={() => setQty((v) => v + 1)}>
            +
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-slate-500">
          취소
        </button>
        <button
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              // 이미 있는 DOT면 그 묶음에 더한다
              const r = await setDotQty({
                productId,
                dot: dot || null,
                qty,
                reason: "입고",
                });
              if (!r.ok) setError(r.error);
              else {
                setOpen(false);
                setDot("");
                router.refresh();
              }
            });
          }}
          className="rounded-lg bg-slate-900 px-6 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "입고"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        같은 DOT가 이미 있으면 그 수량이 <strong>이 숫자로 맞춰집니다</strong> (더해지지 않습니다).
      </p>
    </div>
  );
}

/** 1826 → '2026년 18주' */
function dotLabel(dot: string): string {
  return `20${dot.slice(2, 4)}년 ${Number(dot.slice(0, 2))}주`;
}

/**
 * 단종·미취급 상품을 검색 결과에서 치운다 (2026-08-01).
 * 지우지 않으므로 기표가·규격이 그대로 남고, 다시 받게 되면 되살리면 된다.
 */
export function HideToggle({
  productId,
  isActive,
  hasStock,
}: {
  productId: number;
  isActive: boolean;
  hasStock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!isActive) {
    return (
      <div className="mt-6 rounded-xl border border-slate-300 bg-slate-100 p-4">
        <p className="font-medium text-slate-700">이 상품은 검색에서 숨겨져 있습니다</p>
        <p className="mt-1 text-sm text-slate-500">
          기표가·규격은 그대로 남아 있습니다. 되살리면 바로 상담에 쓸 수 있습니다.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setProductActive(productId, true);
              router.refresh();
            })
          }
          className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : "되살리기"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={pending || hasStock}
        onClick={() =>
          start(async () => {
            await setProductActive(productId, false);
            router.refresh();
          })
        }
        className="w-full rounded-xl border border-slate-300 py-3 text-slate-600 disabled:opacity-40"
      >
        {hasStock ? "재고가 있어 숨길 수 없습니다" : "검색에서 숨기기 (단종·미취급)"}
      </button>
    </div>
  );
}
