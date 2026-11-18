"use client";

import { useId, type ReactNode } from "react";
import { defaultRoomPlan, sanitizePlan, type Plan, type PlanShape, type ShapeKind } from "@/lib/storage-plan-pure";

/**
 * ⭐ 도면 그리기 (2026-11-18 3차 개정 — 사장님 「점찍기 허술·허접: 점이 작고 잘못 눌리고 겹친다」)
 *
 *   🔴 점은 없다. **자리(block 칸) 전체가 누르는 곳**이고, 근처를 눌러 붙는 일도 없다(칸 안을 누르면 그 칸, 밖은 아무 일 없음).
 *   글자는 칸 밖으로 안 나간다(clipPath). 칸에는 짧은 이름 + 세트 수만 — 긴 설명은 도면 밖 목록에.
 *   찾는 칸은 진한 노랑 + 굵은 검정 테두리 + 「여기」 — 깜빡임에만 기대지 않는다. 나머지는 흐리게.
 *   좌표는 가로 100 × 세로 plan.h.
 */
export const SHAPE_STYLE: Record<ShapeKind, { fill: string; stroke: string; dash?: string; text: string }> = {
  building: { fill: "#e2e8f0", stroke: "#334155", text: "#0f172a" },
  room: { fill: "#ffffff", stroke: "#0f172a", text: "#0f172a" },
  block: { fill: "#f8fafc", stroke: "#475569", text: "#0f172a" },
  door: { fill: "#fde68a", stroke: "#92400e", text: "#451a03" },
  stairs: { fill: "#ede9fe", stroke: "#6d28d9", text: "#3b0764" },
  yard: { fill: "#ecfccb", stroke: "#65a30d", dash: "1.2 0.8", text: "#365314" },
  road: { fill: "#cbd5e1", stroke: "#94a3b8", text: "#334155" },
};

export function toPlan(raw: unknown): Plan {
  return sanitizePlan(raw) ?? defaultRoomPlan();
}

/** 글자 폭(em) — 한글은 1, 숫자·영문·공백은 0.6 정도 */
function textEm(label: string): number {
  return [...label].reduce((t, c) => t + (/[ㄱ-힣]/.test(c) ? 1 : 0.6), 0) || 1;
}
/** 칸 안에 들어가는 글자 크기 — 칸에 맞춰 줄이되 3.5단위(폰 ≈11px) 아래면 안 보인다 → 숨기고 아래 목록이 이름을 말한다 */
function fitFont(label: string, w: number, h: number, max: number): number | null {
  const fs = Math.min(max, (w * 0.9) / textEm(label), h * 0.42);
  return fs >= 3.5 ? fs : null;
}

export function ShapeG({
  s,
  state = "normal",
  badge,
}: {
  s: PlanShape;
  /** normal · selected(고른 자리) · target(찾는 자리) · dim(흐리게) */
  state?: "normal" | "selected" | "target" | "dim";
  badge?: string | null;
}) {
  const st = SHAPE_STYLE[s.kind];
  const hot = state === "selected" || state === "target";
  // 화면에 도면이 여럿이어도(배치도+구역) 자르기 틀 id 가 겹치지 않게
  const clip = `clip${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const fs = s.kind === "room" ? null : fitFont(s.label, s.w, s.h, s.kind === "block" ? 5 : 4);
  const bfs = badge ? fitFont(badge, s.w, s.h * 0.7, 3.4) : null;
  return (
    <g opacity={state === "dim" ? 0.35 : 1}>
      <clipPath id={clip}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h} />
      </clipPath>
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        rx={s.kind === "room" ? 0 : 1}
        fill={hot ? "#fcd34d" : st.fill}
        stroke={hot ? "#000" : st.stroke}
        strokeWidth={hot ? 1.1 : s.kind === "room" ? 0.6 : 0.45}
        strokeDasharray={hot ? undefined : st.dash}
      >
        {state === "target" && <animate attributeName="fill" values="#fcd34d;#fde68a;#fcd34d" dur="1.4s" repeatCount="indefinite" />}
      </rect>
      <g clipPath={`url(#${clip})`} style={{ pointerEvents: "none", userSelect: "none" }}>
        {fs && (
          <text
            x={s.x + s.w / 2}
            y={s.y + s.h / 2 - (bfs ? s.h * 0.12 : 0)}
            fontSize={fs}
            fontWeight={800}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={hot ? "#000" : st.text}
          >
            {s.label}
          </text>
        )}
        {bfs && badge && (
          <text x={s.x + s.w / 2} y={s.y + s.h / 2 + s.h * 0.26} fontSize={bfs} fontWeight={700} textAnchor="middle" dominantBaseline="middle" fill="#334155">
            {badge}
          </text>
        )}
      </g>
    </g>
  );
}

export function PlanCanvas({
  plan,
  badges = {},
  selectedId,
  targetId,
  dimOthers = false,
  onSlotTap,
  onShapeTap,
  highlightShapeIds = [],
  className,
  children,
}: {
  plan: Plan;
  /** 자리 id → 「3세트」 */
  badges?: Record<string, string>;
  /** 고른 자리 (창고 실사·위치 정하기) */
  selectedId?: string | null;
  /** 찾는 자리 (찾기 화면) — 「여기」 꼬리표 */
  targetId?: string | null;
  dimOthers?: boolean;
  /** 자리(block) 누르기 — 칸 안만 */
  onSlotTap?: (s: PlanShape) => void;
  /** 배치도 건물 누르기 */
  onShapeTap?: (s: PlanShape) => void;
  /** 배치도에서 강조할 건물 */
  highlightShapeIds?: string[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <svg
      viewBox={`-1 -6 102 ${plan.h + 7}`}
      className={`block w-full select-none rounded-control border border-slate-300 bg-white ${className ?? ""}`}
      style={{ touchAction: "manipulation" }}
    >
      {plan.shapes.map((s) => {
        const isSlot = s.kind === "block";
        // 배치도: 구역에 이어진 칸이면 종류와 상관없이 누를 수 있다(「파란 차양」 등) — 자리 누르기보다 앞선다
        const siteTap = !!onShapeTap && (s.areaIds?.length ?? 0) > 0;
        const slotTap = !siteTap && isSlot && !!onSlotTap;
        const tappable = siteTap || slotTap;
        const state =
          s.id === targetId
            ? "target"
            : s.id === selectedId || highlightShapeIds.includes(s.id)
              ? "selected"
              : dimOthers && isSlot && (targetId || selectedId)
                ? "dim"
                : "normal";
        return (
          <g
            key={s.id}
            onClick={
              tappable
                ? () => {
                    if (siteTap) onShapeTap?.(s);
                    else onSlotTap?.(s);
                  }
                : undefined
            }
            style={tappable ? { cursor: "pointer" } : undefined}
          >
            <ShapeG s={s} state={state} badge={isSlot ? (badges[s.id] ?? null) : null} />
          </g>
        );
      })}
      {/* 「여기」 꼬리표는 맨 마지막에 — 다른 칸이 덮지 못하게. 칸 바로 위(도면 위쪽 여백까지) */}
      {plan.shapes
        .filter((s) => s.id === targetId)
        .map((s) => (
          <g key={`tag-${s.id}`} style={{ pointerEvents: "none" }}>
            <rect x={s.x + s.w / 2 - 7} y={s.y - 5.6} width={14} height={5.4} rx={1} fill="#000" />
            <text x={s.x + s.w / 2} y={s.y - 2.9} fontSize={3.8} fontWeight={900} textAnchor="middle" dominantBaseline="middle" fill="#fff">
              ▼ 여기
            </text>
          </g>
        ))}
      {children}
    </svg>
  );
}

export function areaImageUrl(a: { id: number; hasImage: boolean; ver: number }): string | null {
  return a.hasImage ? `/storage/area/${a.id}/image?v=${a.ver}` : null;
}
