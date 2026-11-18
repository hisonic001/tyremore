"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { nearestPin, siteShapeForArea } from "@/lib/storage-plan-pure";
import type { AreaInfo, PinRow } from "@/lib/tire-storage-data";
import { areaImageUrl, PlanCanvas, toPlan } from "./plan-canvas";

/**
 * ⭐ 위치 찍기 · 찾기 (2026-11-18)
 *   ① 배치도에서 건물을 누르거나 구역 버튼 → ② 구역 도면에서 세트 자리를 누른다.
 *   기존 점 가까이를 누르면 그 점에 붙는다 = 같은 더미(섞여 쌓인 여러 세트, 사장님 11-18).
 */
export function LocationPicker({
  areas,
  pins,
  selfId,
  value,
  pending,
  onSave,
  onCancel,
}: {
  areas: AreaInfo[];
  pins: PinRow[];
  selfId: number;
  value: { areaId: number | null; x: number | null; y: number | null };
  pending?: boolean;
  onSave: (areaId: number | null, x: number, y: number) => void;
  onCancel: () => void;
}) {
  const site = areas.find((a) => a.isSite) ?? null;
  const rooms = areas.filter((a) => !a.isSite);
  const sitePlan = site ? toPlan(site.plan) : null;
  const [areaId, setAreaId] = useState<number | null>(value.areaId ?? null);
  const [choices, setChoices] = useState<number[] | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(
    value.areaId != null && value.x != null && value.y != null ? { x: value.x, y: value.y } : null,
  );
  const [stackWith, setStackWith] = useState<PinRow | null>(null);
  const area = rooms.find((a) => a.id === areaId) ?? null;
  const plan = area ? toPlan(area.plan) : null;
  const inArea = pins.filter((p) => p.areaId === areaId && p.id !== selfId);
  const siteHi = areaId != null ? siteShapeForArea(sitePlan, areaId) : null;

  const pickArea = (id: number) => {
    setAreaId(id);
    setChoices(null);
    setPoint(id === value.areaId && value.x != null && value.y != null ? { x: value.x, y: value.y } : null);
    setStackWith(null);
  };

  return (
    <div className="mt-2 space-y-2 rounded-card border border-slate-300 bg-white p-3">
      <p className="text-sm font-semibold text-slate-700">① 어느 건물·구역인가요?</p>
      {sitePlan && (
        <PlanCanvas
          plan={sitePlan}
          imageUrl={site ? areaImageUrl(site) : null}
          highlightShapeIds={siteHi ? [siteHi.id] : []}
          onShapeTap={(s) => {
            const ids = (s.areaIds ?? []).filter((i) => rooms.some((r) => r.id === i));
            if (ids.length === 1) pickArea(ids[0]);
            else if (ids.length > 1) setChoices(ids);
          }}
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {(choices ? rooms.filter((r) => choices.includes(r.id)) : rooms).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pickArea(r.id)}
            className={`min-h-11 rounded-full px-3.5 text-sm font-medium ${r.id === areaId ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {r.name}
          </button>
        ))}
        {choices && (
          <button type="button" onClick={() => setChoices(null)} className="min-h-11 px-2 text-sm text-slate-500 underline">
            전체 구역
          </button>
        )}
      </div>

      {plan && area && (
        <>
          <p className="text-sm font-semibold text-slate-700">② {area.name} — 세트가 있는 곳을 누르세요</p>
          <PlanCanvas
            plan={plan}
            imageUrl={areaImageUrl(area)}
            pins={inArea}
            ghost={point}
            onTap={(x, y) => {
              const near = nearestPin(inArea, x, y, plan.h, selfId);
              setStackWith(near);
              setPoint(near ? { x: near.x, y: near.y } : { x, y });
            }}
          />
          {stackWith && (
            <Notice tone="info">
              #{formatStorageNo(stackWith.no)} {stackWith.plate ?? ""} 더미에 같이 둡니다 (섞여 쌓인 더미)
            </Notice>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          그만두기
        </Button>
        <Button disabled={!point || areaId == null} pending={pending} onClick={() => point && areaId != null && onSave(areaId, point.x, point.y)}>
          여기에 두기
        </Button>
      </div>
      {value.areaId != null && (
        <button type="button" onClick={() => onSave(null, 0, 0)} className="text-xs text-slate-500 underline underline-offset-2">
          위치 지우기
        </button>
      )}
    </div>
  );
}

/** 찾기 — 배치도에서 건물이 깜빡 → 구역 도면에서 그 세트 점이 깜빡 · 같은 더미 내용 */
export function LocationFinder({ areas, pins, me }: { areas: AreaInfo[]; pins: PinRow[]; me: { id: number; areaId: number; x: number; y: number } }) {
  const site = areas.find((a) => a.isSite) ?? null;
  const area = areas.find((a) => a.id === me.areaId) ?? null;
  const sitePlan = site ? toPlan(site.plan) : null;
  const plan = area ? toPlan(area.plan) : null;
  const siteHi = siteShapeForArea(sitePlan, me.areaId);
  const inArea = pins.filter((p) => p.areaId === me.areaId);
  const stack = useMemo(
    () => inArea.filter((p) => Math.abs(p.x - me.x) < 1e-6 && Math.abs(p.y - me.y) < 1e-6),
    [inArea, me.x, me.y],
  );
  const [pickedGroup, setPickedGroup] = useState<PinRow[] | null>(null);
  if (!area || !plan) return <p className="text-sm text-slate-500">구역이 숨겨졌거나 없습니다 — 위치를 다시 찍어 주세요.</p>;
  return (
    <div className="space-y-2">
      {sitePlan && <PlanCanvas plan={sitePlan} imageUrl={site ? areaImageUrl(site) : null} highlightShapeIds={siteHi ? [siteHi.id] : []} />}
      <p className="text-sm font-semibold">📍 {area.name}</p>
      <PlanCanvas
        plan={plan}
        imageUrl={areaImageUrl(area)}
        pins={inArea}
        highlightPinIds={[me.id]}
        onPinGroupTap={(g) => setPickedGroup(inArea.filter((p) => g.some((x) => x.id === p.id)))}
      />
      {stack.length > 1 && (
        <Notice tone="warn">
          섞인 더미 — {stack.map((p) => `#${formatStorageNo(p.no)} ${p.plate ?? ""} ${p.describe}`).join(" + ")}
        </Notice>
      )}
      {pickedGroup && (
        <ul className="rounded-control bg-slate-50 p-2 text-sm">
          {pickedGroup.map((p) => (
            <li key={p.id}>
              <a href={`/storage/${p.id}`} className="underline underline-offset-2">
                #{formatStorageNo(p.no)} {p.plate} {p.owner} · {p.describe}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
