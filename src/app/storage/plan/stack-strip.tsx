"use client";

import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import type { SetLite } from "./location";

/**
 * ⭐ 더미 그림 — 자리 안 더미들을 「타이어를 쌓은 모양」으로 나란히 (사장님 2026-11-18 5차)
 *
 *   「더미는 나쁘지 않은데 좀 더 시각적인 이미지로 — 더미 모양 이미지에서 갯수를 정하고, 몇 개가 쌓여 있는지 보고,
 *    타이어도 알고 입력하는 직관적인 시스템. 빠르게 쌓고 다음 더미로 넘어가는 게 중요」.
 *
 *   - 더미 하나 = 세로 기둥. 타이어 한 본 = 가로 줄 하나(아래부터 쌓임). 세트마다 색이 다르고 끝 4자리가 적힌다.
 *   - 「지금」 더미는 굵은 검정 테두리. 빈 더미는 점선(「여기 쌓기」).
 *   - 위의 [−] N [+] 로 이 자리 더미 수를 정한다(빈 더미는 그림에만 — 세트를 놓아야 기록된다).
 *   - 아래에 지금 더미의 세트 목록(위에 쌓인 것부터) — 어느 타이어인지 바로 안다.
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
const TIRE_PX = 13; // 타이어 한 본 높이
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

export function StackStrip({ sets, count, current, onPick, onCount, highlightId, showList = true, currentLabel = "지금" }: StackStripProps) {
  const by = stacksOf(sets);
  const minCount = Math.max(1, maxStack(sets));
  const n = Math.max(count, minCount, current ?? 0);
  const tallest = Math.max(4, ...[...by.values()].map((ss) => ss.reduce((t, s) => t + s.qty, 0)));
  const colH = Math.min(tallest, 16) * TIRE_PX + 8;
  // 세트마다 색 — 자리 안에서 번호 순으로 고정
  const colorOf = new Map<number, string>();
  [...sets].sort((a, b) => (a.no ?? 0) - (b.no ?? 0)).forEach((s, i) => colorOf.set(s.id, COLORS[i % COLORS.length]));
  const cur = current != null ? (by.get(current) ?? []) : [];

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

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {Array.from({ length: n }, (_, i) => i + 1).map((no) => {
          const ss = by.get(no) ?? [];
          const tires = ss.reduce((t, s) => t + s.qty, 0);
          const on = no === current;
          // 아래부터 쌓는다 — 먼저 놓인(번호 작은) 세트가 아래
          const ordered = [...ss].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
          return (
            <button
              key={no}
              type="button"
              onClick={() => onPick?.(no)}
              disabled={!onPick}
              className={`flex w-20 shrink-0 flex-col items-stretch rounded-control p-1 ${on ? "bg-slate-900 text-white ring-4 ring-slate-900" : "bg-white"}`}
            >
              <span className="text-center text-sm font-extrabold">{on ? `▼ ${currentLabel}` : `더미 ${no}`}</span>
              <span className={`text-center text-xs font-semibold ${on ? "text-slate-200" : "text-slate-600"}`}>{on ? `더미 ${no} · ${tires}본` : `${tires}본`}</span>
              <div
                className={`mt-1 flex flex-col-reverse justify-start gap-px rounded-md p-0.5 ${ss.length ? "bg-slate-200" : `border-2 border-dashed ${on ? "border-white" : "border-slate-400"}`}`}
                style={{ height: colH }}
              >
                {ss.length === 0 && <span className={`m-auto text-xs font-bold ${on ? "text-white" : "text-slate-500"}`}>여기 쌓기</span>}
                {ordered.map((s) => {
                  const hi = s.id === highlightId;
                  const h = Math.min(s.qty, 16) * TIRE_PX - 1;
                  return (
                    <div
                      key={s.id}
                      className={`relative w-full overflow-hidden rounded ${colorOf.get(s.id)} ${hi ? "outline outline-4 outline-black" : ""}`}
                      style={{ height: h }}
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
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {showList && current != null && (
        <div className="rounded-card border border-slate-300 bg-white p-2">
          <p className="text-sm font-bold">
            더미 {current} — {cur.length ? `${cur.reduce((t, s) => t + s.qty, 0)}본 · ${cur.length}세트 (위에 쌓인 것부터)` : "비어 있음 — 차번호를 치고 「여기 ✓」"}
          </p>
          <ul className="mt-1 space-y-1">
            {[...cur]
              .sort((a, b) => (b.no ?? 0) - (a.no ?? 0))
              .map((s) => (
                <li key={s.id} className={`flex items-center gap-2 text-sm ${s.id === highlightId ? "font-extrabold" : ""}`}>
                  <span className={`inline-block size-4 shrink-0 rounded ${colorOf.get(s.id)}`} />
                  <span className="tabular font-bold">#{formatStorageNo(s.no)}</span>
                  <span className="min-w-0 truncate">
                    {s.plate ?? ""} {s.owner} · {labelKind(s.kind)} {s.describe}
                    {s.id === highlightId ? " ← 이 세트" : ""}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
