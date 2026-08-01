"use client";

import { useEffect, useState } from "react";
import {
  clearCompare,
  getCompare,
  removeFromCompare,
  setCompareQty,
  subscribeCompare,
  type CompareItem,
} from "./compare-store";

const won = (n: number) => n.toLocaleString();

/**
 * 담아둔 타이어 — 스태거드 상담용 (사장님 요청 2026-08-01)
 *
 * 넓은 화면에서는 오른쪽에 붙어 따라다니고, 폰에서는 아래에 접혀 있다.
 * 앞뒤 규격이 달라 검색을 오가도 가격이 남는다.
 */
export function ComparePanel() {
  const [items, setItems] = useState<CompareItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setItems(getCompare());
    sync();
    return subscribeCompare(sync);
  }, []);

  if (items.length === 0) return null;

  const total = items.reduce((s, x) => s + x.salePrice * x.qty, 0);
  const totalQty = items.reduce((s, x) => s + x.qty, 0);

  const list = (
    <ul className="divide-y divide-slate-100">
      {items.map((x) => (
        <li key={x.productId} className="py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{x.model}</div>
              <div className="tabular text-xs text-slate-500">
                {[x.brandName, x.spec].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeFromCompare(x.productId)}
              aria-label="빼기"
              className="shrink-0 px-1 text-slate-300 active:text-slate-600"
            >
              ✕
            </button>
          </div>
          <div className="tabular mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCompareQty(x.productId, x.qty - 1)}
                className="h-7 w-7 rounded border border-slate-300 text-sm font-bold"
              >
                −
              </button>
              <span className="w-8 text-center text-sm font-bold">
                {x.qty}
                <span className="text-xs font-normal text-slate-400">{x.unit}</span>
              </span>
              <button
                type="button"
                onClick={() => setCompareQty(x.productId, x.qty + 1)}
                className="h-7 w-7 rounded border border-slate-300 text-sm font-bold"
              >
                +
              </button>
            </div>
            <span className="text-sm font-bold">{won(x.salePrice * x.qty)}원</span>
          </div>
        </li>
      ))}
    </ul>
  );

  const footer = (
    <div className="tabular mt-2 border-t-2 border-slate-900 pt-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-slate-600">
          합계 <span className="text-xs text-slate-400">{totalQty}개</span>
        </span>
        <span className="text-xl font-bold">{won(total)}원</span>
      </div>
      <button
        type="button"
        onClick={clearCompare}
        className="mt-2 w-full rounded-lg border border-slate-300 py-1.5 text-xs text-slate-500"
      >
        전부 비우기
      </button>
    </div>
  );

  return (
    <>
      {/* 넓은 화면 — 오른쪽에 붙어 따라다닌다 */}
      <aside className="fixed right-4 top-4 z-20 hidden max-h-[85vh] w-64 overflow-y-auto rounded-xl border border-slate-300 bg-white p-3 shadow-lg xl:block">
        <h2 className="mb-1 text-sm font-bold">담아둔 타이어</h2>
        <p className="mb-2 text-xs text-slate-400">앞뒤 규격이 달라도 남습니다</p>
        {list}
        {footer}
      </aside>

      {/* 폰·태블릿 — 아래에 접어 둔다 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-300 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.08)] xl:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="tabular flex w-full items-center justify-between px-4 py-3"
        >
          <span className="text-sm font-semibold">
            담아둔 타이어 <span className="text-slate-400">{items.length}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="text-lg font-bold">{won(total)}원</span>
            <span className="text-slate-400">{open ? "▼" : "▲"}</span>
          </span>
        </button>
        {open && (
          <div className="max-h-[55vh] overflow-y-auto px-4 pb-4">
            {list}
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
