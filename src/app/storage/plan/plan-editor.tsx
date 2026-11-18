"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useConfirm } from "@/components/ui/confirm";
import { Button } from "@/components/ui/button";
import { cloneShapes, moveGroup, newShapeId, nextSlotName, resizeShape, type Plan, type PlanShape, type ShapeKind } from "@/lib/storage-plan-pure";
import { ShapeG } from "./plan-canvas";

/**
 * ⭐ 도면 고치기 (사장님 2026-11-18 — 「도면은 알아서 그려 주거나 내가 살짝 수정 가능하게」)
 *   칸을 손가락으로 끌어 옮기고, 오른쪽 아래 네모를 끌어 크기를 바꾼다. 이름·더하기·지우기는 아래 단추.
 *   배치도(site)에서는 건물 칸을 고른 뒤 「들어갈 구역」을 켜고 끈다.
 *   ⭐ 여러 칸 (사장님 2026-11-18): **Ctrl(맥은 ⌘)+누르기 = 여러 칸 고르기**, 고른 칸 하나를 끌면 **같이 옮겨짐**,
 *   **Ctrl+끌기 = 고른 칸들을 같은 크기로 복사해 새로 만듦**(원래 칸은 제자리). 휴대폰은 Ctrl 이 없어 「복사」 단추.
 *   **Del 키 = 고른 칸 지우기**(확인창 후, 세트가 든 자리는 남김). 이름 칸에 글을 치는 중엔 Del 이 글자만 지운다.
 */
const ADD: { kind: ShapeKind; label: string; w: number; h: number; text: string }[] = [
  { kind: "block", label: "새 자리", w: 22, h: 14, text: "+ 자리" },
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
  occupied = {},
  pending,
  onSave,
  onCancel,
}: {
  initial: Plan;
  isSite: boolean;
  /** 배치도일 때 건물에 이어 붙일 수 있는 구역 */
  areas?: { id: number; name: string }[];
  /** 자리 id → 세트 수 — 세트가 든 자리는 못 지운다(서버도 막음) */
  occupied?: Record<string, number>;
  pending?: boolean;
  onSave: (p: Plan) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<Plan>(initial);
  /** 고른 칸들 (여러 개 가능) — 마지막이 「지금 칸」(이름 고치기·크기) */
  const [sel, setSel] = useState<string[]>([]);
  const drag = useRef<{
    mode: "move" | "resize" | "pending";
    ids: string[];
    sx: number;
    sy: number;
    orig: PlanShape[];
    /** Ctrl 로 누름 — 안 움직이고 떼면 고르기 토글, 움직이면 복사 */
    ctrl: boolean;
    target: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const H = plan.h;
  const selected = sel.length === 1 ? (plan.shapes.find((s) => s.id === sel[0]) ?? null) : null;
  const many = sel.length > 1;

  const units = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * H };
  };
  const update = (id: string, f: (s: PlanShape) => PlanShape) => setPlan((p) => ({ ...p, shapes: p.shapes.map((s) => (s.id === id ? f(s) : s)) }));

  const start = (e: PointerEvent, s: PlanShape, mode: "move" | "resize") => {
    e.stopPropagation();
    const u = units(e);
    const ctrl = e.ctrlKey || e.metaKey;
    svgRef.current?.setPointerCapture(e.pointerId);
    if (mode === "resize") {
      drag.current = { mode, ids: [s.id], sx: u.x, sy: u.y, orig: [s], ctrl: false, target: s.id };
      return;
    }
    if (ctrl) {
      // 아직 모름 — 떼면 고르기 토글, 끌면 복사 (끌 때 이 칸이 안 골라져 있었으면 같이 복사)
      drag.current = { mode: "pending", ids: [], sx: u.x, sy: u.y, orig: [], ctrl: true, target: s.id };
      return;
    }
    // 그냥 누름 — 이미 고른 묶음 안의 칸이면 묶음째, 아니면 이 칸만
    const ids = sel.includes(s.id) && sel.length > 1 ? sel : [s.id];
    if (!(sel.includes(s.id) && sel.length > 1)) setSel([s.id]);
    drag.current = { mode: "move", ids, sx: u.x, sy: u.y, orig: plan.shapes.filter((x) => ids.includes(x.id)), ctrl: false, target: s.id };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const u = units(e);
    const dx = u.x - d.sx;
    const dy = u.y - d.sy;
    if (d.mode === "pending") {
      if (Math.hypot(dx, dy) < 1.5) return;
      // ⭐ Ctrl+끌기 = 복사 — 고른 칸들(+누른 칸)을 같은 크기로 새로 만들고, 새것을 끈다
      const ids = sel.includes(d.target) ? sel : [...sel, d.target];
      const { plan: next, newIds } = cloneShapes(plan, ids);
      setPlan(next);
      setSel(newIds);
      drag.current = { ...d, mode: "move", ids: newIds, orig: next.shapes.filter((x) => newIds.includes(x.id)) };
      return;
    }
    if (d.mode === "resize") {
      const o = d.orig[0];
      update(o.id, () => resizeShape(o, dx, dy, H));
      return;
    }
    const moved = new Map(moveGroup(d.orig, dx, dy, H).map((x) => [x.id, x]));
    setPlan((p) => ({ ...p, shapes: p.shapes.map((x) => moved.get(x.id) ?? x) }));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    // Ctrl+누르고 안 움직였으면 고르기 토글
    if (d?.mode === "pending") setSel((cur) => (cur.includes(d.target) ? cur.filter((x) => x !== d.target) : [...cur, d.target]));
  };

  /** 휴대폰용 — 고른 칸들을 옆에 같은 크기로 복사 */
  const copySelected = () => {
    const { plan: next, newIds } = cloneShapes(plan, sel, 4, 4);
    setPlan(next);
    setSel(newIds);
  };
  const removable = sel.filter((id) => !occupied[id]);
  const [ask, confirmNode] = useConfirm();

  /** 고른 칸 지우기 — 확인창, 세트가 든 자리는 남긴다(서버도 막음) */
  const removeSelected = async () => {
    if (!sel.length) return;
    const kept = sel.length - removable.length;
    if (!removable.length) {
      await ask({ title: "지울 수 없습니다", body: "고른 칸에 모두 보관 세트가 들어 있습니다 — 세트를 다른 자리로 옮긴 뒤 지워 주세요.", confirmLabel: "확인" });
      return;
    }
    const ok = await ask({
      title: `고른 ${removable.length}칸을 지울까요?`,
      body: kept ? `세트가 든 ${kept}칸은 남깁니다. 「도면 저장」을 눌러야 실제로 바뀝니다.` : "「도면 저장」을 눌러야 실제로 바뀝니다.",
      confirmLabel: "지우기",
      tone: "danger",
    });
    if (!ok) return;
    setPlan((p) => ({ ...p, shapes: p.shapes.filter((x) => !removable.includes(x.id)) }));
    setSel(sel.filter((id) => occupied[id]));
  };

  // ⭐ Del 키 (사장님 2026-11-18 「선택 후 del 누르면 확인 후 지워지게」) — 글 치는 칸에서는 안 먹는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      void removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const add = (a: (typeof ADD)[number]) => {
    // 새 자리는 「새 자리 1·2…」 — 같은 이름 두 자리가 생기지 않게 (저장도 겹치면 막음)
    const s: PlanShape = { id: newShapeId(), kind: a.kind, x: 50 - a.w / 2, y: Math.max(0, H / 2 - a.h / 2), w: a.w, h: a.h, label: a.kind === "block" ? nextSlotName(plan) : a.label };
    setPlan((p) => ({ ...p, shapes: [...p.shapes, s] }));
    setSel([s.id]);
  };

  return (
    <div>
      {confirmNode}
      <p className="mb-1 text-xs text-slate-500">
        칸을 끌어 옮기고, 오른쪽 아래 파란 네모를 끌어 크기를 바꾸세요. 칸을 누르면 이름을 고칠 수 있습니다.
        <br />
        <strong>Ctrl+누르기</strong> = 여러 칸 고르기 · 고른 칸을 끌면 같이 옮겨짐 · <strong>Ctrl+끌기</strong> = 같은 크기로 복사 · <strong>Del</strong> = 지우기
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 100 ${H}`}
        className="block w-full select-none rounded-control border-2 border-blue-400 bg-white"
        style={{ touchAction: "none" }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerDown={(e) => !(e.ctrlKey || e.metaKey) && setSel([])}
      >
        {plan.shapes.map((s) => (
          <g key={s.id} onPointerDown={(e) => start(e, s, "move")} style={{ cursor: "move" }}>
            <ShapeG s={s} state={sel.includes(s.id) ? "selected" : "normal"} badge={occupied[s.id] ? `${occupied[s.id]}세트` : null} />
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
        {sel.length > 0 && (
          <button type="button" onClick={copySelected} className="min-h-11 rounded-control border-2 border-blue-500 bg-white px-3 text-sm font-bold text-blue-700">
            고른 {sel.length}칸 복사
          </button>
        )}
      </div>

      {many && (
        <div className="mt-2 flex items-center gap-2 rounded-control bg-blue-50 p-2">
          <p className="min-w-0 flex-1 text-sm font-semibold text-blue-900">{sel.length}칸 골랐습니다 — 하나를 끌면 같이 옮겨집니다</p>
          <button
            type="button"
            disabled={removable.length === 0}
            onClick={() => void removeSelected()}
            className="min-h-11 shrink-0 rounded-control border border-red-200 px-3 text-sm text-red-600 disabled:border-slate-200 disabled:text-slate-400"
          >
            {removable.length === sel.length ? `${sel.length}칸 지우기` : `빈 ${removable.length}칸 지우기`}
          </button>
        </div>
      )}

      {selected && (
        <div className="mt-2 space-y-2 rounded-control bg-slate-50 p-2">
          <div className="flex items-center gap-2">
            <input
              value={selected.label}
              onChange={(e) => update(selected.id, (s) => ({ ...s, label: e.target.value.slice(0, 30) }))}
              placeholder="자리 이름 (예: 선반 1, 안쪽 2)"
              className="min-w-0 flex-1 rounded-control border border-slate-300 bg-white px-3 py-2.5 text-base"
            />
            <button
              type="button"
              disabled={!!occupied[selected.id]}
              onClick={() => {
                setPlan((p) => ({ ...p, shapes: p.shapes.filter((s) => s.id !== selected.id) }));
                setSel([]);
              }}
              className="min-h-11 shrink-0 rounded-control border border-red-200 px-3 text-sm text-red-600 disabled:border-slate-200 disabled:text-slate-400"
            >
              지우기
            </button>
          </div>
          {occupied[selected.id] ? (
            <p className="text-sm font-semibold text-amber-800">이 자리에 {occupied[selected.id]}세트가 있어 지울 수 없습니다 — 이름·크기는 바꿔도 됩니다</p>
          ) : null}
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
