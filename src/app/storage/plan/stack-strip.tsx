"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
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
 *     휴대폰 터치도 되게 포인터 이벤트로(브라우저 기본 끌기는 터치에서 안 된다).
 *   - ⭐ **휴대폰은 꾹 눌러야(0.3초) 이동이 켜진다** (사장님 「휴대폰에서 잘 안 됨 — 조금 꾹 누르면 활성화로」). 바로 밀면 화면이 넘어가고,
 *     꾹 누르면 진동 + 덩어리가 들린 뒤 끈다. 켜진 뒤에만 touchmove 를 막아(passive:false) 화면이 같이 밀리지 않게.
 *     길게 누르기 메뉴·글자 선택은 끈다. 🔴 마우스도 똑같이 꾹 눌러야 한다(사장님 「누르고 있어야만 이동」).
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
  /** ⭐ 두 번 톡톡(더블클릭) = 그 세트 내용 고치기 (사장님 2026-11-18) */
  onEdit?: (setId: number) => void;
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

export function StackStrip({ sets, count, current, onPick, onCount, highlightId, showList = true, currentLabel = "지금", onDrop, onEdit }: StackStripProps) {
  /** 두 번 톡톡 알아보기 — 같은 덩어리를 0.35초 안에 두 번 */
  const lastTap = useRef<{ id: number; t: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean; armed: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  /** 꾹 눌러 들린 덩어리 (그림 강조) */
  const [armedId, setArmedId] = useState<number | null>(null);
  /** 들린 뒤 실제로 움직이는 중 — 이때부터 손가락 따라 덩어리가 보이고 원래 자리는 흐려진다 */
  const [moving, setMoving] = useState(false);

  // 이동이 켜진 뒤에만 화면 스크롤을 막는다 — 켜지기 전에 밀면 그냥 스크롤
  useEffect(() => {
    const stop = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, []);
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

  const LONG_MS = 300;
  const reset = () => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
    setArmedId(null);
    setMoving(false);
    setDrag(null);
  };
  const down = (e: RPointerEvent<HTMLDivElement>, id: number) => {
    if (!onDrop && !onEdit) return;
    e.stopPropagation();
    // 🔴 마우스도 꾹 눌러야 켜진다 (사장님 2026-11-18 「누르고 있어야만 이동 가능하게」) — 실수로 끌리는 일이 없게
    const x = e.clientX;
    const y = e.clientY;
    press.current = { id, x, y, moved: false, armed: false, timer: null };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (onDrop) {
      press.current.timer = setTimeout(() => {
        const p = press.current;
        if (!p || p.id !== id || p.moved) return;
        p.armed = true;
        setArmedId(id);
        setDrag({ id, x: p.x, y: p.y, ...targetAt(p.x, p.y, id) });
        try {
          navigator.vibrate?.(40);
        } catch {
          /* 무시 */
        }
      }, LONG_MS);
    }
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 8;
    if (!p.armed) {
      // 꾹 누르기 전에 밀었다 = 스크롤하려는 것 — 이동은 안 켠다
      if (far) reset();
      return;
    }
    if (!p.moved && !far) return;
    if (!p.moved) setMoving(true);
    p.moved = true;
    p.x = e.clientX;
    p.y = e.clientY;
    setDrag({ id: p.id, x: e.clientX, y: e.clientY, ...targetAt(e.clientX, e.clientY, p.id) });
  };
  const up = () => {
    const p = press.current;
    const d = drag;
    reset();
    // 그냥 톡 누름(꾹·끌기 아님) — 같은 덩어리를 곧 또 누르면 고치기
    if (p && !p.armed && !p.moved && onEdit) {
      const now = Date.now();
      if (lastTap.current && lastTap.current.id === p.id && now - lastTap.current.t < 350) {
        lastTap.current = null;
        onEdit(p.id);
      } else lastTap.current = { id: p.id, t: now };
      return;
    }
    if (!p?.armed || !p.moved || !d || d.to == null || !onDrop) return;
    justDropped.current = true;
    setTimeout(() => (justDropped.current = false), 300);
    const order = bottomUp((by.get(d.to) ?? []).filter((s) => s.id !== d.id)).map((s) => s.id);
    order.splice(Math.min(d.at, order.length), 0, d.id);
    const from = sets.find((s) => s.id === d.id);
    const before = from?.stackNo != null ? bottomUp(by.get(from.stackNo) ?? []).map((s) => s.id) : [];
    if (from?.stackNo === d.to && before.join() === order.join()) return; // 제자리
    onDrop(d.id, d.to, order);
  };
  const cancel = () => reset();

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
                      onContextMenu={onDrop ? (e) => e.preventDefault() : undefined}
                      className={`relative w-full shrink-0 select-none overflow-hidden rounded ${colorOf.get(s.id)} ${s.id === highlightId ? "outline outline-4 outline-black" : ""} ${
                        moving && drag?.id === s.id ? "opacity-30" : ""
                      } ${armedId === s.id && !moving ? "z-10 scale-110 shadow-lg ring-4 ring-amber-500" : ""} ${onDrop ? "cursor-grab" : ""}`}
                      style={{ height: Math.min(s.qty, 16) * TIRE_PX - 1, WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
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
      {drag && dragged && moving && (
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

      {onDrop && (
        <p className="mb-1 text-xs text-slate-600">
          잘못 쌓았으면 덩어리를 <strong>꾹 누르고(살짝 진동)</strong> 끌어 위·아래나 다른 더미에 놓으세요. 내용 고치기는 덩어리를 <strong>두 번 톡톡</strong>.
        </p>
      )}

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
