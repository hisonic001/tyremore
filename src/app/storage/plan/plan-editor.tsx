"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { moveShape, newShapeId, resizeShape, type Plan, type PlanShape, type ShapeKind } from "@/lib/storage-plan-pure";
import { ShapeG } from "./plan-canvas";

/**
 * ⭐ 도면 고치기 (사장님 2026-11-18 — 「도면은 알아서 그려 주거나 내가 살짝 수정 가능하게」)
 *   칸을 손가락으로 끌어 옮기고, 오른쪽 아래 네모를 끌어 크기를 바꾼다. 이름·더하기·지우기는 아래 단추.
 *   배치도(site)에서는 건물 칸을 고른 뒤 「들어갈 구역」을 켜고 끈다.
 */
const ADD: { kind: ShapeKind; label: string; w: number; h: number; text: string }[] = [
  { kind: "block", label: "새 칸", w: 20, h: 12, text: "+ 칸(더미 자리)" },
  { kind: "door", label: "출입문", w: 16, h: 5, text: "+ 문" },
  { kind: "stairs", label: "계단", w: 12, h: 10, text: "+ 계단" },
];
const ADD_SITE: { kind: ShapeKind; label: string; w: number; h: number; text: string }[] = [
  { kind: "building", label: "새 건물", w: 18, h: 14, text: "+ 건물" },
  { kind: "yard", label: "마당", w: 20, h: 10, text: "+ 마당" },
];

export function PlanEditor({
  initial,
  isSite,
  areas = [],
  imageUrl,
  pending,
  onSave,
  onCancel,
}: {
  initial: Plan;
  isSite: boolean;
  /** 배치도일 때 건물에 이어 붙일 수 있는 구역 */
  areas?: { id: number; name: string }[];
  imageUrl?: string | null;
  pending?: boolean;
  onSave: (p: Plan) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const drag = useRef<{ mode: "move" | "resize"; id: string; sx: number; sy: number; orig: PlanShape } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const H = plan.h;
  const selected = plan.shapes.find((s) => s.id === sel) ?? null;

  const units = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * H };
  };
  const update = (id: string, f: (s: PlanShape) => PlanShape) => setPlan((p) => ({ ...p, shapes: p.shapes.map((s) => (s.id === id ? f(s) : s)) }));

  const start = (e: PointerEvent, s: PlanShape, mode: "move" | "resize") => {
    e.stopPropagation();
    setSel(s.id);
    const u = units(e);
    drag.current = { mode, id: s.id, sx: u.x, sy: u.y, orig: s };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const u = units(e);
    const dx = u.x - d.sx;
    const dy = u.y - d.sy;
    update(d.id, () => (d.mode === "move" ? moveShape(d.orig, dx, dy, H) : resizeShape(d.orig, dx, dy, H)));
  };
  const end = () => {
    drag.current = null;
  };

  const add = (a: (typeof ADD)[number]) => {
    const s: PlanShape = { id: newShapeId(), kind: a.kind, x: 50 - a.w / 2, y: Math.max(0, H / 2 - a.h / 2), w: a.w, h: a.h, label: a.label };
    setPlan((p) => ({ ...p, shapes: [...p.shapes, s] }));
    setSel(s.id);
  };

  return (
    <div>
      <p className="mb-1 text-xs text-slate-500">칸을 끌어 옮기고, 오른쪽 아래 파란 네모를 끌어 크기를 바꾸세요. 칸을 누르면 이름을 고칠 수 있습니다.</p>
      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${H}`}
        className="block w-full select-none rounded-control border-2 border-blue-400 bg-white"
        style={{ touchAction: "none" }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={() => setSel(null)}
      >
        {imageUrl && <image href={imageUrl} x={0} y={0} width={100} height={H} preserveAspectRatio="xMidYMid slice" opacity={0.45} />}
        {plan.shapes.map((s) => (
          <g key={s.id} onPointerDown={(e) => start(e, s, "move")} style={{ cursor: "move" }}>
            <ShapeG s={s} selected={s.id === sel} />
          </g>
        ))}
        {selected && (
          <rect
            x={selected.x + selected.w - 3.2}
            y={selected.y + selected.h - 3.2}
            width={3.2}
            height={3.2}
            fill="#2563eb"
            stroke="#fff"
            strokeWidth={0.3}
            style={{ cursor: "nwse-resize" }}
            onPointerDown={(e) => start(e, selected, "resize")}
          />
        )}
      </svg>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(isSite ? ADD_SITE : ADD).map((a) => (
          <button key={a.text} type="button" onClick={() => add(a)} className="min-h-11 rounded-control border border-slate-300 bg-white px-3 text-sm font-medium">
            {a.text}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-2 space-y-2 rounded-control bg-slate-50 p-2">
          <div className="flex items-center gap-2">
            <input
              value={selected.label}
              onChange={(e) => update(selected.id, (s) => ({ ...s, label: e.target.value.slice(0, 30) }))}
              placeholder="칸 이름 (예: 선반 1, 안쪽 더미)"
              className="min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-3 py-2.5 text-base"
            />
            <button
              type="button"
              onClick={() => {
                setPlan((p) => ({ ...p, shapes: p.shapes.filter((s) => s.id !== selected.id) }));
                setSel(null);
              }}
              className="min-h-11 shrink-0 rounded-control border border-red-200 px-3 text-sm text-red-600"
            >
              지우기
            </button>
          </div>
          {isSite && selected.kind === "building" && areas.length > 0 && (
            <div>
              <p className="text-xs text-slate-500">이 건물을 누르면 들어갈 구역</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {areas.map((a) => {
                  const on = selected.areaIds?.includes(a.id) ?? false;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        update(selected.id, (s) => {
                          const ids = new Set(s.areaIds ?? []);
                          if (on) ids.delete(a.id);
                          else ids.add(a.id);
                          return { ...s, areaIds: [...ids] };
                        })
                      }
                      className={`min-h-10 rounded-full px-3 text-sm ${on ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                    >
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel}>
          그만두기
        </Button>
        <Button pending={pending} onClick={() => onSave(plan)}>
          도면 저장
        </Button>
      </div>
    </div>
  );
}
