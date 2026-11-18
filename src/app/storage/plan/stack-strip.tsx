"use client";

import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import type { SetLite } from "./location";

/**
 * ⭐ 더미 그림 — 자리 안 더미들을 「타이어를 쌓은 모양」으로 나란히 (사장님 2026-11-18 5차)
 *
 *   「더미는 나쁘지 않은데 좀 더 시각적인 이미지로 — 더미 모양 이미지에서 갯수를 정하고, 몇 개가 쌓여 있는지 보고,
 *    타이어도 알고 입력하는 직관적인 시스템. 빠르게 쌓고 다음 더미로 넘어가는 게 중요」.
 *
 *   - 더미 하나 = 세로 기둥. 타이어 한 본 = 가로 줄 하나(아래부터 쌓임). 세트마다 색이 다르고 끝 4자리가 적힌다.
 *   - 「지금」 더미는 검정. 빈 더미는 점선(「여기 쌓기」). 위의 [−] N [+] 로 이 자리 더미 수를 정한다.
 *   - ⭐ **고치기 = 끌어다 놓기** (사장님 「위아래 잘못 쌓음 → 버튼 늘리지 말고 드래그앤드롭」):
 *     타이어 덩어리를 잡고 끌어 같은 더미 위·아래나 다른 더미에 놓는다. 놓을 자리에 검정 줄이 보인다.
 *     휴대폰 터치도 되게 포인터 이벤트로(브라우저 기본 끌기는 터치에서 안 된다). 잡은 덩어리는 화면을 스크롤하지 않는다.
 */

const COLORS = [
  "bg-amber-300 text-amber-950",
  "bg-sky-300 text-sky-950",
  "bg-emerald-300 text-emerald-950",
  "bg-rose-300 text-rose-950",
  "bg-violet-300 text-violet-950",
  "bg-lime-300 text-lime-950",
  "bg-orange-300 text-orange-950",
  "bg-teal-300 text-teal-950",
];
const TIRE_PX = 15; // 타이어 한 본 높이 — 손가락으로 잡을 만하게
const tail4 = (p: string | null) => (p ?? "").replace(/\s/g, "").slice(-4);

export interface StackStripProps {
  /** 이 자리의 세트들 (보관중 · 위치 있음) */
  sets: SetLite[];
  /** 보여 줄 더미 수 — 세트가 든 가장 큰 번호보다 작아지지 않는다 */
  count: number;
  /** 지금 고른 더미 번호 (없으면 null) */
  current: number | null;
  onPick?: (no: number) => void;
  onCount?: (n: number) => void;
  /** 찾기 화면 — 이 세트를 강조 */
  highlightId?: number;
  /** 아래 세트 목록을 보일지 */
  showList?: boolean;
  /** 고른 더미 위 글자 — 실사 「지금」, 찾기 「여기」 */
  currentLabel?: string;
  /** ⭐ 끌어다 놓기 — 있으면 덩어리를 잡을 수 있다. toStack 의 새 순서(아래→위) 를 준다 */
  onDrop?: (setId: number, toStack: number, bottomToTop: number[]) => void;
}

/** 더미 안 아래→위 순서 — 위치를 정한 시각(늦을수록 위), 시각이 없으면(옛 세트) 아래쪽·보관번호 순 */
export function bottomUp(ss: SetLite[]): SetLite[] {
  return [...ss].sort((a, b) => (a.placedAt ?? -Infinity) - (b.placedAt ?? -Infinity) || (a.no ?? 0) - (b.no ?? 0));
}

export function stacksOf(sets: SetLite[]): Map<number, SetLite[]> {
  const m = new Map<number, SetLite[]>();
  for (const s of sets) if (s.stackNo != null) m.set(s.stackNo, [...(m.get(s.stackNo) ?? []), s]);
  return m;
}

/** 세트가 든 가장 큰 더미 번호 (없으면 0) */
export function maxStack(sets: SetLite[]): number {
  return sets.reduce((m, s) => Math.max(m, s.stackNo ?? 0), 0);
}

interface Drag {
  id: number;
  x: number;
  y: number;
  /** 놓을 더미 · 그 더미 아래에서 몇 번째(0 = 맨 아래) */
  to: number | null;
  at: number;
}

export function StackStrip({ sets, count, current, onPick, onCount, highlightId, showList = true, currentLabel = "지금", onDrop }: StackStripProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /** 끌기가 끝난 직후 기둥 「누르기」가 같이 일어나지 않게 */
  const justDropped = useRef(false);

  const by = stacksOf(sets);
  const minCount = Math.max(1, maxStack(sets));
  const n = Math.max(count, minCount, current ?? 0);
  const tallest = Math.max(4, ...[...by.values()].map((ss) => ss.reduce((t, s) => t + s.qty, 0)));
  const colH = (Math.min(tallest, 16) + (onDrop ? 1 : 0)) * TIRE_PX + 8;
  // 세트마다 색 — 자리 안에서 번호 순으로 고정
  const colorOf = new Map<number, string>();
  [...sets].sort((a, b) => (a.no ?? 0) - (b.no ?? 0)).forEach((s, i) => colorOf.set(s.id, COLORS[i % COLORS.length]));
  const cur = current != null ? bottomUp(by.get(current) ?? []) : [];
  const dragged = drag ? sets.find((s) => s.id === drag.id) : null;

  /** 손가락 아래 더미와 그 안 몇 번째인지 — 잡은 덩어리는 빼고 센다 */
  const targetAt = (x: number, y: number, id: number): { to: number | null; at: number } => {
    const col = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stack]");
    if (!col) return { to: null, at: 0 };
    const to = Number(col.dataset.stack);
    const blocks = [...col.querySelectorAll<HTMLElement>("[data-set]")].filter((b) => Number(b.dataset.set) !== id);
    // 아래쪽(화면 y 가 큰 쪽)에 있는 덩어리 수 = 아래에서 몇 번째에 넣을지
    const at = blocks.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.top + r.height / 2 > y;
    }).length;
    return { to, at };
  };

  const down = (e: RPointerEvent<HTMLDivElement>, id: number) => {
    if (!onDrop) return;
    e.stopPropagation();
    press.current = { id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
    p.moved = true;
    setDrag({ id: p.id, x: e.clientX, y: e.clientY, ...targetAt(e.clientX, e.clientY, p.id) });
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    const d = drag;
    setDrag(null);
    if (!p?.moved || !d || d.to == null || !onDrop) return;
    justDropped.current = true;
    setTimeout(() => (justDropped.current = false), 300);
    const order = bottomUp((by.get(d.to) ?? []).filter((s) => s.id !== d.id)).map((s) => s.id);
    order.splice(Math.min(d.at, order.length), 0, d.id);
    const from = sets.find((s) => s.id === d.id);
    const before = from?.stackNo != null ? bottomUp(by.get(from.stackNo) ?? []).map((s) => s.id) : [];
    if (from?.stackNo === d.to && before.join() === order.join()) return; // 제자리
    onDrop(d.id, d.to, order);
  };
  const cancel = () => {
    press.current = null;
    setDrag(null);
  };

  return (
    <div>
      {onCount && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-base font-bold">이 자리 더미</span>
          <button
            type="button"
            onClick={() => onCount(Math.max(minCount, n - 1))}
            disabled={n <= minCount}
            className="size-11 rounded-control border-2 border-slate-900 text-xl font-extrabold disabled:border-slate-300 disabled:text-slate-300"
            aria-label="더미 하나 빼기"
          >
            −
          </button>
          <span className="tabular w-8 text-center text-2xl font-extrabold">{n}</span>
          <button
            type="button"
            onClick={() => onCount(Math.min(99, n + 1))}
            className="size-11 rounded-control border-2 border-slate-900 text-xl font-extrabold"
            aria-label="더미 하나 더하기"
          >
            +
          </button>
          <span className="text-sm text-slate-600">개</span>
        </div>
      )}

      <div className={`-mx-1 flex gap-2 px-1 pb-2 ${drag ? "overflow-x-hidden" : "overflow-x-auto"}`}>
        {Array.from({ length: n }, (_, i) => i + 1).map((no) => {
          const all = by.get(no) ?? [];
          const tires = all.reduce((t, s) => t + s.qty, 0);
          const on = no === current;
          const isTarget = drag?.to === no;
          // 아래부터 쌓는다 — 먼저 놓인 세트가 아래. 끄는 중이면 놓을 자리에 줄을 넣는다
          // 🔴 잡은 덩어리는 화면에서 빼지 않는다(흐리게만) — 빼면 손가락 추적(pointer capture)이 끊긴다
          const ordered = bottomUp(all);
          const items: (SetLite | "bar")[] = [];
          let k = 0;
          for (const s of ordered) {
            if (isTarget && s.id !== drag!.id && k++ === drag!.at) items.push("bar");
            items.push(s);
          }
          if (isTarget && !items.includes("bar")) items.push("bar");
          return (
            <div
              key={no}
              role="button"
              tabIndex={0}
              data-stack={no}
              onClick={() => !justDropped.current && onPick?.(no)}
              className={`flex w-20 shrink-0 cursor-pointer flex-col items-stretch rounded-control p-1 ${
                on ? "bg-slate-900 text-white ring-4 ring-slate-900" : "bg-white"
              } ${isTarget ? "outline outline-4 outline-offset-2 outline-amber-500" : ""}`}
            >
              <span className="text-center text-sm font-extrabold">{on ? `▼ ${currentLabel}` : `더미 ${no}`}</span>
              <span className={`text-center text-xs font-semibold ${on ? "text-slate-200" : "text-slate-600"}`}>{on ? `더미 ${no} · ${tires}본` : `${tires}본`}</span>
              <div
                className={`mt-1 flex flex-col-reverse justify-start gap-px rounded-md p-0.5 ${items.length ? "bg-slate-200" : `border-2 border-dashed ${on ? "border-white" : "border-slate-400"}`}`}
                style={{ height: colH }}
              >
                {items.length === 0 && <span className={`m-auto text-xs font-bold ${on ? "text-white" : "text-slate-500"}`}>여기 쌓기</span>}
                {items.map((s) =>
                  s === "bar" ? (
                    <div key="bar" className="h-1.5 w-full shrink-0 rounded-full bg-amber-500" />
                  ) : (
                    <div
                      key={s.id}
                      data-set={s.id}
                      onPointerDown={(e) => down(e, s.id)}
                      onPointerMove={move}
                      onPointerUp={up}
                      onPointerCancel={cancel}
                      className={`relative w-full shrink-0 overflow-hidden rounded ${colorOf.get(s.id)} ${s.id === highlightId ? "outline outline-4 outline-black" : ""} ${
                        drag?.id === s.id ? "opacity-30" : ""
                      } ${onDrop ? "cursor-grab" : ""}`}
                      style={{ height: Math.min(s.qty, 16) * TIRE_PX - 1, touchAction: onDrop ? "none" : undefined }}
                    >
                      {/* 타이어 줄 — 한 본에 한 줄 */}
                      <div
                        className="absolute inset-0 opacity-60"
                        style={{ backgroundImage: `repeating-linear-gradient(to top, rgba(15,23,42,.85) 0 ${TIRE_PX - 4}px, transparent ${TIRE_PX - 4}px ${TIRE_PX}px)` }}
                      />
                      <span className="relative block truncate px-0.5 text-center text-[11px] font-extrabold leading-tight text-white drop-shadow">
                        {s.kind === "스노" ? "❄" : ""}
                        {tail4(s.plate) || formatStorageNo(s.no)}·{s.qty}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 끄는 덩어리 — 손가락을 따라간다 */}
      {drag && dragged && (
        <div
          className={`pointer-events-none fixed z-50 w-20 -translate-x-1/2 -translate-y-1/2 rounded px-1 py-1 text-center text-xs font-extrabold text-white shadow-xl ${colorOf.get(dragged.id)}`}
          style={{ left: drag.x, top: drag.y }}
        >
          <span className="drop-shadow">
            {tail4(dragged.plate)}·{dragged.qty}본
          </span>
          <span className="block text-[10px] text-slate-900">{drag.to ? `더미 ${drag.to}에 놓기` : "더미 위로"}</span>
        </div>
      )}

      {onDrop && <p className="mb-1 text-xs text-slate-600">잘못 쌓았으면 타이어 덩어리를 꾹 잡고 끌어서 위·아래나 다른 더미에 놓으세요.</p>}

      {showList && current != null && (
        <div className="rounded-card border border-slate-300 bg-white p-2">
          <p className="text-sm font-bold">
            더미 {current} — {cur.length ? `${cur.reduce((t, s) => t + s.qty, 0)}본 · ${cur.length}세트 (위에 쌓인 것부터)` : "비어 있음 — 차번호를 치고 「여기 ✓」"}
          </p>
          <ul className="mt-1 space-y-1">
            {[...cur].reverse().map((s) => (
              <li key={s.id} className={`flex items-center gap-2 text-sm ${s.id === highlightId ? "font-extrabold" : ""}`}>
                <span className={`inline-block size-4 shrink-0 rounded ${colorOf.get(s.id)}`} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-bold">
                    <span className="tabular">#{formatStorageNo(s.no)}</span> {s.plate ?? ""} {s.owner}
                    {s.id === highlightId ? " ← 이 세트" : ""}
                  </span>
                  <span className="block truncate text-xs text-slate-600">
                    {labelKind(s.kind)} {s.describe}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
