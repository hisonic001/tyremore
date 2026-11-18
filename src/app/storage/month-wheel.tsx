"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * ⭐ 맡긴 달 고르기 — 연도·월 바퀴 (사장님 2026-11-18 「날짜 입력은 저렇게(버튼 줄) 말고 — 연도·월이 나오게 하고 누른 뒤 스크롤해서 고르게」)
 *   단추를 누르면 연도·월 두 줄이 열리고, 손가락으로 굴려 가운데 줄에 맞춘 뒤 「확인」.
 *   미래 달은 고를 수 없다(올해는 이번 달까지).
 */

const ROW = 44; // 한 줄 높이 — 손가락 하나
const SHOW = 5; // 보이는 줄 수 (가운데가 고른 것)

function Wheel({ items, index, onIndex, disabledFrom }: { items: string[]; index: number; onIndex: (i: number) => void; disabledFrom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const max = disabledFrom != null ? Math.min(items.length, disabledFrom) - 1 : items.length - 1;

  // 처음·바깥에서 값이 바뀌면 그 줄로 — 그리기 전에 바로 맞춘다(부드럽게 굴리면 처음에 안 먹었다)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || Math.round(el.scrollTop / ROW) === index) return;
    el.scrollTop = index * ROW;
    const raf = requestAnimationFrame(() => {
      if (Math.round(el.scrollTop / ROW) !== index) el.scrollTop = index * ROW;
    });
    return () => cancelAnimationFrame(raf);
  }, [index]);

  const settle = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.max(0, Math.min(max, Math.round(el.scrollTop / ROW)));
    el.scrollTo({ top: i * ROW, behavior: "smooth" });
    if (i !== index) onIndex(i);
  };

  return (
    <div className="relative flex-1">
      {/* 가운데 고른 줄 표시 */}
      <div className="pointer-events-none absolute inset-x-1 rounded-control border-y-2 border-slate-900 bg-slate-100" style={{ top: ROW * 2, height: ROW }} />
      <div
        ref={ref}
        onScroll={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(settle, 120);
        }}
        className="relative snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: ROW * SHOW, paddingTop: ROW * 2, paddingBottom: ROW * 2 }}
      >
        {items.map((t, i) => {
          const off = i > max;
          return (
            <button
              key={t}
              type="button"
              disabled={off}
              onClick={() => ref.current?.scrollTo({ top: i * ROW, behavior: "smooth" })}
              className={`flex w-full snap-center items-center justify-center text-xl tabular ${i === index ? "font-extrabold text-slate-900" : off ? "text-slate-300" : "text-slate-500"}`}
              style={{ height: ROW }}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 「연-월」 → 그 달 가운데 날짜(오늘보다 뒤면 오늘) — 「맡긴 날 대략」으로 남긴다 */
export function monthToDate(y: number, m: number, today: string): string {
  const mid = `${y}-${String(m).padStart(2, "0")}-15`;
  return mid > today ? today : mid;
}

export function MonthWheel({ value, today, onChange }: { value: { y: number; m: number }; today: string; onChange: (v: { y: number; m: number }) => void }) {
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const years = Array.from({ length: 7 }, (_, i) => ty - 6 + i); // 6년 전 ~ 올해
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const yi = Math.max(0, years.indexOf(draft.y));
  const monthMax = draft.y === ty ? tm : 12; // 올해는 이번 달까지

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen((o) => !o);
        }}
        className="min-h-12 rounded-control border-2 border-slate-900 bg-white px-4 text-lg font-extrabold tabular"
      >
        {value.y}년 {value.m}월 ▾
      </button>
      {open && (
        <div className="mt-2 rounded-card border-2 border-slate-900 bg-white p-2 shadow-lg">
          <div className="flex gap-2">
            <Wheel
              items={years.map((y) => `${y}년`)}
              index={yi}
              onIndex={(i) => setDraft((d) => ({ y: years[i], m: years[i] === ty ? Math.min(d.m, tm) : d.m }))}
            />
            <Wheel
              items={Array.from({ length: 12 }, (_, i) => `${i + 1}월`)}
              index={Math.min(draft.m, monthMax) - 1}
              disabledFrom={monthMax}
              onIndex={(i) => setDraft((d) => ({ ...d, m: i + 1 }))}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-control border-2 border-slate-300 text-base font-bold">
              취소
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ y: draft.y, m: Math.min(draft.m, monthMax) });
                setOpen(false);
              }}
              className="min-h-12 flex-[2] rounded-control bg-slate-900 text-base font-extrabold text-white"
            >
              {draft.y}년 {Math.min(draft.m, monthMax)}월로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
