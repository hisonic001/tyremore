"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { placeHere } from "@/lib/storage-area";
import { dismissCandidate } from "@/lib/tire-storage";
import type { AreaInfo } from "@/lib/tire-storage-data";
import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import { nearestPin } from "@/lib/storage-plan-pure";
import { areaImageUrl, PlanCanvas, toPlan } from "./plan-canvas";

export interface CountSet {
  id: number;
  no: number | null;
  status: string;
  plate: string | null;
  owner: string;
  describe: string;
  kind: string | null;
  areaId: number | null;
  x: number | null;
  y: number | null;
}

/** 로컬 저장 — 막히면(사생활 창 등) 조용히 무시 */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 무시 */
    }
  },
};
const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();

/**
 * ⭐ 창고 실사 — 더미 단위 한 화면 (사장님 2026-11-18 — 「위치 찍기 너무 불편. 실사 때 간편하게 한 번에」)
 *
 *   ① 구역 한 번(계속 유지) ② 도면에서 지금 더미 자리 한 번(유지 — 기존 점을 누르면 그 더미)
 *   ③ 타이어에 적힌 차번호 끝 4자리 → 뜨는 세트에 「여기 ✓」 한 번 = 실사 확인 + 번호 + 위치가 동시에.
 *   다음 더미는 도면 다른 곳을 누른다. 끝나면 「오늘 한 것 스티커 인쇄」.
 */
export function WarehouseCount({ areas, sets: initial, today }: { areas: AreaInfo[]; sets: CountSet[]; today: string }) {
  const rooms = areas.filter((a) => !a.isSite);
  const [sets, setSets] = useState<CountSet[]>(initial);
  const [areaId, setAreaId] = useState<number | null>(rooms[0]?.id ?? null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [q, setQ] = useState("");
  const [done, setDone] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, start] = useTransition();
  const [ask, confirmNode] = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const doneKey = `storage.count.done.${today}`;

  // 지난번 구역·오늘 한 것 이어서 (기기별 편의)
  useEffect(() => {
    const a = Number(store.get("storage.count.area"));
    if (rooms.some((r) => r.id === a)) setAreaId(a);
    try {
      const d = JSON.parse(store.get(doneKey) ?? "[]");
      if (Array.isArray(d)) setDone(d.filter((n) => Number.isInteger(n)));
    } catch {
      /* 무시 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const area = rooms.find((a) => a.id === areaId) ?? null;
  const plan = area ? toPlan(area.plan) : null;
  const pins = useMemo(
    () =>
      sets
        .filter((s) => s.areaId === areaId && s.x != null && s.y != null)
        .map((s) => ({ id: s.id, no: s.no, x: s.x!, y: s.y!, kind: s.kind })),
    [sets, areaId],
  );
  const stack = point ? sets.filter((s) => s.areaId === areaId && s.x != null && Math.abs(s.x - point.x) < 1e-6 && Math.abs(s.y! - point.y) < 1e-6) : [];
  const unplaced = sets.filter((s) => s.areaId == null);

  const results = useMemo(() => {
    const t = norm(q);
    if (!t) return unplaced.slice(0, 12);
    const digits = /^\d+$/.test(t);
    return sets
      .filter((s) => norm(s.plate ?? "").includes(t) || norm(s.owner).includes(t) || (digits && s.no != null && String(s.no) === String(Number(t))))
      .sort((a, b) => Number(a.areaId != null) - Number(b.areaId != null))
      .slice(0, 20);
  }, [q, sets, unplaced]);

  const pickArea = (id: number) => {
    setAreaId(id);
    setPoint(null);
    store.set("storage.count.area", String(id));
  };

  const place = (s: CountSet) => {
    if (!point || areaId == null) return;
    setBusyId(s.id);
    start(async () => {
      const r = await placeHere(s.id, areaId, point.x, point.y);
      setBusyId(null);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setSets((all) => all.map((x) => (x.id === s.id ? { ...x, status: "보관중", no: r.no, areaId, x: point.x, y: point.y } : x)));
      setDone((d) => {
        const next = d.includes(s.id) ? d : [...d, s.id];
        store.set(doneKey, JSON.stringify(next));
        return next;
      });
      setMsg({ tone: "success", text: `#${formatStorageNo(r.no)} ${s.plate ?? ""} — ${r.confirmed ? "실사 확인 · " : ""}여기 둠` });
      setQ("");
      inputRef.current?.focus();
    });
  };

  const notHere = async (s: CountSet) => {
    if (!(await ask({ title: `${s.plate ?? ""} ${s.owner} — 창고에 없나요?`, body: "실사 후보에서 뺍니다(기록은 남습니다).", confirmLabel: "없음", tone: "danger" }))) return;
    start(async () => {
      const r = await dismissCandidate(s.id);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setSets((all) => all.filter((x) => x.id !== s.id));
      setMsg({ tone: "success", text: `${s.plate ?? ""} 없음 처리` });
    });
  };

  return (
    <div className="mt-3 pb-24">
      {confirmNode}
      {/* ① 구역 */}
      <div className="flex flex-wrap gap-1.5">
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pickArea(r.id)}
            className={`min-h-11 rounded-full px-3.5 text-sm font-semibold ${r.id === areaId ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* ② 지금 더미 자리 */}
      {plan && area && (
        <div className="mt-2">
          <PlanCanvas
            plan={plan}
            imageUrl={areaImageUrl(area)}
            pins={pins}
            ghost={point}
            highlightPinIds={stack.map((s) => s.id)}
            onTap={(x, y) => {
              const near = nearestPin(pins, x, y, plan.h);
              setPoint(near ? { x: near.x, y: near.y } : { x, y });
            }}
            onPinGroupTap={(g) => setPoint({ x: g[0].x, y: g[0].y })}
          />
          <p className="mt-1 text-sm">
            {point ? (
              stack.length ? (
                <>
                  <strong>이 더미</strong>: {stack.map((s) => `#${formatStorageNo(s.no)} ${s.plate ?? ""}`).join(" · ")}
                </>
              ) : (
                <span className="text-brand-700">새 더미 자리를 골랐습니다 — 아래에서 세트를 찾아 「여기 ✓」</span>
              )
            ) : (
              <span className="font-semibold text-amber-700">👆 도면에서 지금 서 있는 더미 자리를 누르세요 (기존 점을 누르면 그 더미)</span>
            )}
          </p>
        </div>
      )}

      {/* ③ 찾기 → 여기 ✓ */}
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="타이어에 적힌 차번호 끝 4자리 · 이름 · 보관번호"
        className="mt-3 w-full rounded-control border-2 border-slate-400 bg-white px-4 py-3 text-lg placeholder:text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
      />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {!q && <p className="mt-2 text-xs text-slate-500">위치 없는 세트 {unplaced.length}개 (실사 전 {unplaced.filter((s) => s.status === "확인대기").length}) — 번호 순 일부</p>}
      <div className="mt-1 divide-y divide-slate-100">
        {results.map((s) => {
          const here = point && s.areaId === areaId && s.x != null && Math.abs(s.x - point.x) < 1e-6 && Math.abs(s.y! - point.y) < 1e-6;
          return (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">
                  {s.plate ?? "차량 없음"} · {s.owner}
                </p>
                <p className="truncate text-sm text-slate-500">
                  {s.status === "확인대기" ? <span className="font-semibold text-amber-700">실사 전 · </span> : <span className="tabular font-semibold text-slate-700">#{formatStorageNo(s.no)} · </span>}
                  {labelKind(s.kind)} {s.describe}
                  {s.areaId != null && !here ? ` · 📍${rooms.find((r) => r.id === s.areaId)?.name ?? ""}` : ""}
                </p>
                {s.status === "확인대기" && (
                  <button type="button" onClick={() => notHere(s)} className="mt-0.5 text-xs text-slate-500 underline">
                    창고에 없음
                  </button>
                )}
              </div>
              <button
                type="button"
                disabled={!point || busyId === s.id || !!here}
                onClick={() => place(s)}
                className="min-h-12 shrink-0 rounded-control bg-brand-600 px-4 text-base font-bold text-white disabled:bg-slate-300"
              >
                {here ? "✓ 여기" : busyId === s.id ? "…" : "여기 ✓"}
              </button>
            </div>
          );
        })}
        {q && results.length === 0 && <p className="py-4 text-center text-sm text-slate-500">찾는 세트가 없습니다 — 처음 보는 세트면 위 「+ 맡김 등록」</p>}
      </div>

      {/* 오늘 한 것 — 스티커 한꺼번에 */}
      {done.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:bottom-0">
          <span className="text-sm">
            오늘 한 것 <strong>{done.length}</strong>세트
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDone([]);
                store.set(doneKey, "[]");
              }}
              className="min-h-11 px-2 text-xs text-slate-500 underline"
            >
              비우기
            </button>
            <a
              href={`/print/storage?ids=${done.join(",")}`}
              target="_blank"
              className="inline-flex min-h-11 items-center rounded-control bg-slate-900 px-4 text-sm font-semibold text-white"
            >
              스티커 인쇄
            </a>
          </span>
        </div>
      )}
    </div>
  );
}
