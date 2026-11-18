"use client";

import { useMemo, useState } from "react";
import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import { siteShapeForArea, slotLabel, slotsOf, stacksIn } from "@/lib/storage-plan-pure";
import type { AreaInfo } from "@/lib/tire-storage-data";
import { PlanCanvas, toPlan } from "./plan-canvas";
import { maxStack, StackStrip } from "./stack-strip";

/**
 * ⭐ 위치 고르기 · 찾기 (2026-11-18 3차 개정)
 *   위치 = 구역 › 자리 › 더미. 고르기는 **큰 버튼 세 줄**(구역 → 자리 → 더미). 도면은 자리를 누르는 또 하나의 길일 뿐 —
 *   작은 칸도 아래 자리 버튼으로 정확히 고른다. 근처 누르면 붙는 일·점은 없다.
 */

export interface SetLite {
  id: number;
  no: number | null;
  status: string;
  plate: string | null;
  owner: string;
  describe: string;
  kind: string | null;
  qty: number;
  areaId: number | null;
  slotId: string | null;
  stackNo: number | null;
  /** 더미 안 순서 — 늦게 놓을수록 위 (없으면 맨 아래 쪽) */
  placedAt?: number | null;
}

export interface LocValue {
  areaId: number | null;
  slotId: string | null;
  /** 더미 번호 · 「새 더미」 · 아직 안 고름 */
  stack: number | "new" | null;
}


export function LocationChooser({
  areas,
  sets,
  value,
  onChange,
  selfId,
}: {
  areas: AreaInfo[];
  /** 자리·더미 배지와 더미 내용에 쓰는 세트들 (보관중·실사 전) */
  sets: SetLite[];
  value: LocValue;
  onChange: (v: LocValue) => void;
  /** 위치를 바꾸는 그 세트 — 더미 세트 수에서 뺀다 */
  selfId?: number;
}) {
  const rooms = areas.filter((a) => !a.isSite);
  const others = useMemo(() => sets.filter((s) => s.id !== selfId), [sets, selfId]);
  const area = rooms.find((a) => a.id === value.areaId) ?? null;
  const plan = area ? toPlan(area.plan) : null;
  const slots = slotsOf(plan);
  const perSlot = (slotId: string) => others.filter((s) => s.areaId === area?.id && s.slotId === slotId);
  const badges: Record<string, string> = {};
  for (const sl of slots) {
    const n = perSlot(sl.id).length;
    if (n) badges[sl.id] = `${n}세트`;
  }

  // 자리를 누르면 그 자리 **마지막 더미**를 고른 채로(이어 쌓기) — 비었으면 더미 1. 다른 더미는 그림에서 누른다 (5차)
  const pickSlot = (slotId: string) => {
    const top = area ? maxStack(others.filter((s) => s.areaId === area.id && s.slotId === slotId)) : 0;
    setStackCount(Math.max(1, top));
    onChange({ areaId: value.areaId, slotId, stack: Math.max(1, top) });
  };
  const slotSets = area && value.slotId ? others.filter((s) => s.areaId === area.id && s.slotId === value.slotId) : [];
  const [stackCount, setStackCount] = useState(() => Math.max(1, maxStack(slotSets), typeof value.stack === "number" ? value.stack : 0));

  return (
    <div className="space-y-3">
      {/* A. 구역 */}
      <div>
        <p className="mb-1 text-sm font-bold text-slate-700">① 구역</p>
        <div className="grid grid-cols-2 gap-2">
          {rooms.map((r) => {
            const n = others.filter((s) => s.areaId === r.id).length;
            const on = r.id === value.areaId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (r.id === value.areaId) return; // 같은 구역을 다시 눌러도 자리·더미는 그대로
                  onChange({ areaId: r.id, slotId: null, stack: null });
                }}
                className={`min-h-14 rounded-control px-3 text-left text-base font-bold ${on ? "bg-slate-900 text-white" : "border-2 border-slate-300 bg-white text-slate-900"}`}
              >
                {r.name}
                <span className={`block text-xs font-medium ${on ? "text-slate-300" : "text-slate-500"}`}>{n}세트</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* B. 자리 — 도면 또는 버튼 */}
      {area && plan && (
        <div>
          <p className="mb-1 text-sm font-bold text-slate-700">② 자리 — 도면의 칸이나 아래 버튼을 누르세요</p>
          <PlanCanvas plan={plan} badges={badges} selectedId={value.slotId} dimOthers={!!value.slotId} onSlotTap={(s) => pickSlot(s.id)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {slots.map((sl, i) => {
              const ss = perSlot(sl.id);
              const st = stacksIn(ss, area.id, sl.id).length;
              const on = sl.id === value.slotId;
              return (
                <button
                  key={sl.id}
                  type="button"
                  onClick={() => pickSlot(sl.id)}
                  className={`min-h-12 rounded-control px-3 text-left ${on ? "bg-amber-300 font-extrabold text-black ring-2 ring-black" : "border border-slate-300 bg-white font-bold text-slate-900"}`}
                >
                  {sl.label || `칸 ${i + 1}`}
                  <span className="ml-1 text-xs font-medium text-slate-600">{ss.length ? `${st}더미 · ${ss.length}세트` : "비어 있음"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* C. 더미 */}
      {area && value.slotId && (
        <div>
          <p className="mb-1 text-sm font-bold text-slate-700">③ 더미 — 그림에서 누르세요</p>
          <StackStrip
            sets={slotSets}
            count={stackCount}
            current={typeof value.stack === "number" ? value.stack : null}
            onPick={(no) => onChange({ ...value, stack: no })}
            onCount={(n) => {
              setStackCount(n);
              if (typeof value.stack === "number" && value.stack > n) onChange({ ...value, stack: n });
            }}
          />
        </div>
      )}
    </div>
  );
}

/** 지금 고른 위치 한 줄 — 「흰색 창고 › 안쪽 2 › 더미 3」 */
export function chosenText(areas: AreaInfo[], v: LocValue, sets: SetLite[], selfId?: number): string | null {
  const area = areas.find((a) => a.id === v.areaId);
  if (!area) return null;
  const plan = toPlan(area.plan);
  const parts = [area.name];
  if (v.slotId) parts.push(slotLabel(plan, v.slotId) ?? "");
  if (v.slotId && v.stack != null) {
    // 옮기는 그 세트는 빼고 센다 — 서버(resolveLoc)와 같은 번호가 보이게
    const nextNo = stacksIn(sets.filter((s) => s.id !== selfId), area.id, v.slotId).reduce((m, s) => Math.max(m, s.no), 0) + 1;
    parts.push(v.stack === "new" ? `새 더미 ${nextNo}` : `더미 ${v.stack}`);
  }
  return parts.join(" › ");
}

/**
 * 찾기 — 🔴 글자가 먼저(크게), 도면은 확인용. 같은 더미에 섞인 세트를 이 세트와 구분해 보여 준다.
 */
export function LocationFinder({
  areas,
  me,
  mates,
  slotSets = [],
}: {
  areas: AreaInfo[];
  me: { id: number; areaId: number; slotId: string | null; stackNo: number | null };
  mates: SetLite[];
  /** 같은 자리 세트 전부 — 더미 그림(5차) */
  slotSets?: SetLite[];
}) {
  const site = areas.find((a) => a.isSite) ?? null;
  const area = areas.find((a) => a.id === me.areaId) ?? null;
  if (!area) return <p className="text-sm font-semibold text-amber-700">구역이 숨겨졌거나 없습니다 — 위치를 다시 정해 주세요.</p>;
  const plan = toPlan(area.plan);
  const sitePlan = site ? toPlan(site.plan) : null;
  const siteHi = siteShapeForArea(sitePlan, area.id);
  const label = slotLabel(plan, me.slotId);
  const tires = mates.reduce((t, s) => t + s.qty, 0);
  const mixed = mates.length > 1;
  const self = mates.find((s) => s.id === me.id);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-600">{area.name}</p>
        <p className="text-3xl font-extrabold leading-tight text-slate-900">{label ?? "자리 미정"}</p>
        {me.stackNo != null && <span className="mt-1 inline-block rounded-lg bg-slate-900 px-3 py-0.5 text-2xl font-extrabold text-white">더미 {me.stackNo}</span>}
      </div>

      {mixed && (
        <div className="rounded-card border-2 border-amber-400 bg-amber-50 p-3">
          <p className="font-bold text-slate-900">
            이 더미 {tires}본 = {mates.map((s) => s.qty).join(" + ")} (섞여 쌓임)
          </p>
          <ul className="mt-1 space-y-1">
            {mates.map((s) => (
              <li key={s.id} className={`rounded-control px-2 py-1.5 ${s.id === me.id ? "bg-white font-extrabold ring-2 ring-black" : "text-slate-700"}`}>
                #{formatStorageNo(s.no)} {labelKind(s.kind)} {s.describe}
                {s.id === me.id ? " ← 이 세트" : ` · ${s.plate ?? ""}`}
              </li>
            ))}
          </ul>
          {self && <p className="mt-1 text-sm font-semibold text-amber-900">스티커 {formatStorageNo(self.no)} 붙은 {self.qty}개만 꺼내세요</p>}
        </div>
      )}

      {slotSets.length > 0 && me.stackNo != null && (
        <div>
          <p className="mb-1 text-sm font-bold text-slate-700">이 자리 더미 — 검정 테두리가 이 세트</p>
          <StackStrip sets={slotSets} count={maxStack(slotSets)} current={me.stackNo} highlightId={me.id} showList={false} currentLabel="여기" />
        </div>
      )}

      <PlanCanvas plan={plan} targetId={me.slotId} dimOthers />
      {sitePlan && (
        <div className="mx-auto w-2/3">
          <PlanCanvas plan={sitePlan} highlightShapeIds={siteHi ? [siteHi.id] : []} />
        </div>
      )}
    </div>
  );
}
