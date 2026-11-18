"use client";

import type { MouseEvent, ReactNode } from "react";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { defaultRoomPlan, sanitizePlan, type Plan, type PlanShape, type ShapeKind } from "@/lib/storage-plan-pure";

/**
 * ⭐ 도면 그리기 (2026-11-18) — 칸(사각형) + 세트 점. 보기·위치 찍기·찾기·고치기가 같이 쓴다.
 *   좌표는 가로 100 × 세로 plan.h. 점은 0~1 비율. 같은 좌표의 점은 하나로 묶어 「더미」로 그린다.
 */
export const SHAPE_STYLE: Record<ShapeKind, { fill: string; stroke: string; dash?: string; text: string }> = {
  building: { fill: "#e2e8f0", stroke: "#334155", text: "#0f172a" },
  room: { fill: "#ffffff", stroke: "#334155", text: "#0f172a" },
  block: { fill: "#f1f5f9", stroke: "#94a3b8", dash: "1.2 0.8", text: "#334155" },
  door: { fill: "#fde68a", stroke: "#b45309", text: "#78350f" },
  stairs: { fill: "#ede9fe", stroke: "#7c3aed", text: "#4c1d95" },
  yard: { fill: "#ecfccb", stroke: "#84cc16", dash: "1.2 0.8", text: "#365314" },
  road: { fill: "#cbd5e1", stroke: "#94a3b8", text: "#334155" },
};

export function toPlan(raw: unknown): Plan {
  return sanitizePlan(raw) ?? defaultRoomPlan();
}

export interface CanvasPin {
  id: number;
  no: number | null;
  x: number;
  y: number;
  kind?: string | null;
}

export function ShapeG({ s, selected, highlight }: { s: PlanShape; selected?: boolean; highlight?: boolean }) {
  const st = SHAPE_STYLE[s.kind];
  const fs = Math.max(2.2, Math.min(3.4, s.w / Math.max(4, s.label.length) * 1.5, s.h * 0.45));
  return (
    <g>
      <rect
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        rx={s.kind === "room" ? 0 : 0.8}
        fill={highlight ? "#fef08a" : st.fill}
        stroke={selected ? "#2563eb" : highlight ? "#ca8a04" : st.stroke}
        strokeWidth={selected || highlight ? 0.8 : 0.4}
        strokeDasharray={selected ? undefined : st.dash}
      >
        {highlight && <animate attributeName="fill-opacity" values="1;0.45;1" dur="1.2s" repeatCount="indefinite" />}
      </rect>
      {s.label && (
        <text
          x={s.x + s.w / 2}
          y={s.kind === "room" ? s.y + 3.4 : s.y + s.h / 2}
          fontSize={fs}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={st.text}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {s.label}
        </text>
      )}
    </g>
  );
}

/** 같은 좌표 점 묶기 — 섞인 더미 */
function groupPins(pins: CanvasPin[]): { x: number; y: number; pins: CanvasPin[] }[] {
  const m = new Map<string, { x: number; y: number; pins: CanvasPin[] }>();
  for (const p of pins) {
    const k = `${p.x.toFixed(5)}|${p.y.toFixed(5)}`;
    const g = m.get(k) ?? { x: p.x, y: p.y, pins: [] };
    g.pins.push(p);
    m.set(k, g);
  }
  return [...m.values()];
}

export function PlanCanvas({
  plan,
  imageUrl,
  pins = [],
  highlightPinIds = [],
  highlightShapeIds = [],
  ghost,
  onTap,
  onShapeTap,
  onPinGroupTap,
  children,
  className,
}: {
  plan: Plan;
  imageUrl?: string | null;
  pins?: CanvasPin[];
  highlightPinIds?: number[];
  highlightShapeIds?: string[];
  /** 아직 저장 안 한 새 점 (위치 찍기 미리보기) */
  ghost?: { x: number; y: number } | null;
  onTap?: (x01: number, y01: number) => void;
  onShapeTap?: (s: PlanShape) => void;
  onPinGroupTap?: (pins: CanvasPin[]) => void;
  children?: ReactNode;
  className?: string;
}) {
  const H = plan.h;
  const tap = (e: MouseEvent<SVGSVGElement>) => {
    if (!onTap) return;
    const r = e.currentTarget.getBoundingClientRect();
    onTap((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  return (
    <svg
      viewBox={`0 0 100 ${H}`}
      className={`block w-full select-none rounded-control border border-slate-300 bg-white ${onTap ? "cursor-crosshair" : ""} ${className ?? ""}`}
      style={{ touchAction: "manipulation" }}
      onClick={tap}
    >
      {imageUrl && <image href={imageUrl} x={0} y={0} width={100} height={H} preserveAspectRatio="xMidYMid slice" opacity={0.55} />}
      {plan.shapes.map((s) => (
        <g
          key={s.id}
          onClick={
            onShapeTap
              ? (e) => {
                  e.stopPropagation();
                  onShapeTap(s);
                }
              : undefined
          }
          style={onShapeTap && s.areaIds?.length ? { cursor: "pointer" } : undefined}
          opacity={imageUrl && (s.kind === "room" || s.kind === "block") ? 0.75 : 1}
        >
          <ShapeG s={s} highlight={highlightShapeIds.includes(s.id)} />
        </g>
      ))}
      {groupPins(pins).map((g) => {
        const hot = g.pins.some((p) => highlightPinIds.includes(p.id));
        const cx = g.x * 100;
        const cy = g.y * H;
        const first = g.pins[0];
        return (
          <g
            key={`${g.x}|${g.y}`}
            onClick={
              onPinGroupTap
                ? (e) => {
                    e.stopPropagation();
                    onPinGroupTap(g.pins);
                  }
                : undefined
            }
            style={onPinGroupTap ? { cursor: "pointer" } : undefined}
          >
            {hot && (
              <circle cx={cx} cy={cy} r={3} fill="none" stroke="#dc2626" strokeWidth={0.6}>
                <animate attributeName="r" values="2.5;6;2.5" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={cx} cy={cy} r={hot ? 2.3 : 1.7} fill={hot ? "#dc2626" : "#475569"} stroke="#fff" strokeWidth={0.35} />
            <text
              x={cx}
              y={cy - (hot ? 3.2 : 2.6)}
              fontSize={hot ? 3 : 2.3}
              fontWeight={800}
              textAnchor="middle"
              fill={hot ? "#b91c1c" : "#334155"}
              stroke="#fff"
              strokeWidth={0.5}
              paintOrder="stroke"
              style={{ pointerEvents: "none" }}
            >
              {formatStorageNo(first.no)}
              {g.pins.length > 1 ? ` +${g.pins.length - 1}` : ""}
            </text>
          </g>
        );
      })}
      {ghost && (
        <g style={{ pointerEvents: "none" }}>
          <circle cx={ghost.x * 100} cy={ghost.y * H} r={2.4} fill="#2563eb" stroke="#fff" strokeWidth={0.4} />
          <circle cx={ghost.x * 100} cy={ghost.y * H} r={4} fill="none" stroke="#2563eb" strokeWidth={0.4} />
        </g>
      )}
      {children}
    </svg>
  );
}

export function areaImageUrl(a: { id: number; hasImage: boolean; ver: number }): string | null {
  return a.hasImage ? `/storage/area/${a.id}/image?v=${a.ver}` : null;
}
