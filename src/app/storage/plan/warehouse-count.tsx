"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { placeHere, undoPlace, type PrevLoc } from "@/lib/storage-area";
import { dismissCandidate } from "@/lib/tire-storage";
import type { AreaInfo } from "@/lib/tire-storage-data";
import { formatStorageNo, labelKind } from "@/lib/tire-storage-pure";
import { slotLabel, slotsOf } from "@/lib/storage-plan-pure";
import { chosenText, LocationChooser, type LocValue, type SetLite } from "./location";
import { toPlan } from "./plan-canvas";
import { FoundSetForm, type FoundSetDone } from "../found-set-form";
import { maxStack, StackStrip } from "./stack-strip";

/** 기기 저장 — 막히면(사생활 창 등) 조용히 무시 */
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
const tail4 = (p: string | null) => (p ?? "").replace(/\s/g, "").slice(-4);
const LOC_KEY = "storage.count.loc";
/** 기억한 위치는 30분까지만 바로 쓴다 — 어제 위치로 곧장 넣는 일이 없게 (검토 2026-11-18) */
const LOC_FRESH_MS = 30 * 60 * 1000;

/**
 * ⭐ 창고 실사 — 더미 단위 한 화면 (5차 2026-11-18: 더미를 **그림**으로 — stack-strip.tsx, 「다음 더미 →」 한 번)
 * (아래는 3차 설명) (2026-11-18 3차 개정, 사장님 「점찍기 허술·허접 — 찾는 사람 입장에서 각잡고」)
 *
 *   맨 위 「지금 위치」(구역 › 자리 › 더미)가 고정이다. 고르기는 큰 버튼 세 줄 → 고르면 접힌다.
 *   타이어에 적힌 차번호 끝 4자리 → 「여기 ✓」 한 번 = 실사 확인 + 번호 + 위치. 8초 「되돌리기」.
 *   다른 곳에 있던 세트는 「여기로 옮길까요?」. 실사 중엔 화면이 꺼지지 않는다.
 */
export function WarehouseCount({ areas, sets: initial, today }: { areas: AreaInfo[]; sets: SetLite[]; today: string }) {
  const rooms = areas.filter((a) => !a.isSite);
  const [ready, setReady] = useState(false);
  const [sets, setSets] = useState<SetLite[]>(initial);
  const [loc, setLoc] = useState<LocValue>({ areaId: null, slotId: null, stack: null });
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [hangul, setHangul] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [undo, setUndo] = useState<{ id: number; placed: { areaId: number; slotId: string; stackNo: number }; prev: PrevLoc; confirmed: boolean; label: string } | null>(null);
  /** 검색칸에 손가락이 있으면(키보드 열림) 아래 띠를 숨긴다 — 「여기 ✓」를 가리지 않게 */
  const [typing, setTyping] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** 처음 보는 세트 — 손님·차가 앱에 없어도 이 화면에서 등록 (사장님 2026-11-18) */
  const [found, setFound] = useState<string | null>(null);
  /** 이 자리 더미 수 (그림의 [−] N [+]) — 빈 더미는 그림에만, 기기에 자리마다 기억 */
  const [stackCount, setStackCount] = useState(1);
  const [, start] = useTransition();
  const [ask, confirmNode] = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const doneKey = `storage.count.done.${today}`;
  const complete = loc.areaId != null && !!loc.slotId && loc.stack != null;

  // 🔴 기억한 위치를 **첫 화면 전에** 되살린다 — 다른 구역으로 잘못 넣는 일이 없게. 도면에서 사라진 자리면 버린다
  useEffect(() => {
    try {
      const saved = JSON.parse(store.get(LOC_KEY) ?? "null") as (LocValue & { at?: number }) | null;
      const area = rooms.find((r) => r.id === saved?.areaId);
      if (saved && area) {
        const slotOk = !!saved.slotId && slotsOf(toPlan(area.plan)).some((s) => s.id === saved.slotId);
        const next: LocValue = { areaId: area.id, slotId: slotOk ? saved.slotId : null, stack: slotOk ? saved.stack : null };
        setLoc(next);
        // 30분 안 + 다 골라져 있을 때만 바로 실사 화면 — 아니면 고르는 화면을 열어 둔다(「이 더미에서 실사 시작」을 눌러야 시작)
        const fresh = typeof saved.at === "number" && Date.now() - saved.at < LOC_FRESH_MS;
        setOpen(!(fresh && next.slotId && next.stack != null));
      }
      const d = JSON.parse(store.get(doneKey) ?? "[]");
      if (Array.isArray(d)) setDone(d.filter((n) => Number.isInteger(n)));
    } catch {
      /* 무시 */
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자리가 바뀌면 그 자리에 정해 둔 더미 수를 되살린다
  useEffect(() => {
    if (loc.areaId == null || !loc.slotId) return;
    setStackCount(Math.max(1, Number(store.get(countKey)) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.areaId, loc.slotId]);

  // 「새 더미」(옛 기억값)는 번호로 바꿔 둔다 — 그림이 번호로 움직인다
  useEffect(() => {
    if (ready && complete && loc.stack === "new") changeLoc({ ...loc, stack: curStack });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, complete, loc.stack]);

  // 실사 중엔 화면이 꺼지지 않게 (지원 안 하는 기기는 그냥 넘어감)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const get = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void get();
    const vis = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      void lock?.release().catch(() => {});
    };
  }, []);

  // 되돌리기는 8초
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  // 🔴 저절로 접지 않는다 — 잘못 누른 한 번이 위치가 되지 않게. 「이 더미에서 실사 시작」을 눌러야 시작
  const changeLoc = (v: LocValue) => {
    setLoc(v);
    store.set(LOC_KEY, JSON.stringify({ ...v, at: Date.now() }));
  };
  const startHere = () => {
    store.set(LOC_KEY, JSON.stringify({ ...loc, at: Date.now() }));
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const area = rooms.find((a) => a.id === loc.areaId) ?? null;
  const plan = area ? toPlan(area.plan) : null;
  const slotSets = area && loc.slotId ? sets.filter((s) => s.areaId === area.id && s.slotId === loc.slotId && s.status === "보관중") : [];
  const countKey = `storage.count.stacks.${loc.areaId}.${loc.slotId}`;
  const curStack = typeof loc.stack === "number" ? loc.stack : maxStack(slotSets) + 1;
  const shownCount = Math.max(stackCount, maxStack(slotSets), curStack, 1);
  const setCount = (n: number) => {
    setStackCount(n);
    store.set(countKey, String(n));
  };
  /** ⭐ 다음 더미로 — 한 번. 없으면 하나 늘려서 (5차) */
  const nextStack = () => {
    const next = curStack + 1;
    if (next > shownCount) setCount(next);
    changeLoc({ ...loc, stack: next });
    try {
      navigator.vibrate?.(20);
    } catch {
      /* 무시 */
    }
    setTimeout(() => inputRef.current?.focus(), 30);
  };
  const here = (s: SetLite) => s.areaId === loc.areaId && s.slotId === loc.slotId && loc.stack !== "new" && s.stackNo === loc.stack;
  const stats = {
    pending: sets.filter((s) => s.status === "확인대기").length,
    unplaced: sets.filter((s) => s.areaId == null).length,
  };

  const results = useMemo(() => {
    const t = norm(q);
    if (!t) return [];
    const digits = /^\d+$/.test(t);
    const rank = (s: SetLite) =>
      (digits && tail4(s.plate) === t ? 0 : 10) + (here(s) ? 5 : s.status === "확인대기" ? 0 : s.areaId == null ? 1 : 3);
    return sets
      .filter((s) => norm(s.plate ?? "").includes(t) || norm(s.owner).includes(t) || (digits && s.no != null && String(s.no) === String(Number(t))))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sets, loc]);

  const whereText = (s: SetLite) => {
    const a = rooms.find((r) => r.id === s.areaId);
    if (!a) return null;
    return [a.name, slotLabel(toPlan(a.plan), s.slotId), s.stackNo ? `더미 ${s.stackNo}` : null].filter(Boolean).join(" › ");
  };

  const place = async (s: SetLite) => {
    if (!complete) return;
    const elsewhere = s.areaId != null && !here(s) ? whereText(s) : null;
    if (elsewhere && !(await ask({ title: "다른 곳에 있던 세트입니다", body: `지금 기록: ${elsewhere}\n\n여기(${chosenText(areas, loc, sets)})로 옮길까요?`, confirmLabel: "여기로 옮기기" })))
      return;
    setBusyId(s.id);
    start(async () => {
      const r = await placeHere(s.id, { areaId: loc.areaId!, slotId: loc.slotId!, stack: loc.stack! });
      setBusyId(null);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setSets((all) => all.map((x) => (x.id === s.id ? { ...x, status: "보관중", no: r.no, areaId: loc.areaId, slotId: loc.slotId, stackNo: r.stackNo } : x)));
      if (loc.stack === "new") changeLoc({ ...loc, stack: r.stackNo }); // 새 더미 → 진짜 번호로, 그대로 고른 채
      setDone((d) => {
        const next = d.includes(s.id) ? d : [...d, s.id];
        store.set(doneKey, JSON.stringify(next));
        return next;
      });
      const label = `#${formatStorageNo(r.no)} ${s.plate ?? ""} → 더미 ${r.stackNo}${r.confirmed ? " (실사 확인)" : ""}`;
      setMsg({ tone: "success", text: `✓ ${label}` });
      setUndo({ id: s.id, placed: { areaId: loc.areaId!, slotId: loc.slotId!, stackNo: r.stackNo }, prev: r.prev, confirmed: r.confirmed, label });
      try {
        navigator.vibrate?.(30);
      } catch {
        /* 무시 */
      }
      setQ("");
      inputRef.current?.focus();
    });
  };

  const doUndo = () => {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    start(async () => {
      const r = await undoPlace(u.id, u.placed, u.prev, u.confirmed);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setSets((all) =>
        all.map((x) =>
          x.id === u.id
            ? {
                ...x,
                areaId: u.prev.areaId,
                slotId: u.prev.slotId,
                stackNo: u.prev.stackNo,
                ...(r.unconfirmed ? { status: "확인대기", no: null } : {}),
              }
            : x,
        ),
      );
      setDone((d) => {
        const next = d.filter((n) => n !== u.id);
        store.set(doneKey, JSON.stringify(next));
        return next;
      });
      setMsg({ tone: "success", text: r.note });
    });
  };

  const foundDone = (r: FoundSetDone) => {
    const lite: SetLite = {
      id: r.id,
      no: r.no,
      status: "보관중",
      plate: r.plate,
      owner: r.owner,
      describe: [r.drop.brand, r.drop.size, `${r.drop.qty}본`].filter(Boolean).join(" "),
      kind: r.drop.kind,
      qty: r.drop.qty,
      areaId: loc.areaId,
      slotId: loc.slotId,
      stackNo: r.stackNo,
    };
    setSets((all) => [...all, lite]);
    if (loc.stack === "new" && r.stackNo != null) changeLoc({ ...loc, stack: r.stackNo });
    setDone((d) => {
      const next = [...d, r.id];
      store.set(doneKey, JSON.stringify(next));
      return next;
    });
    setFound(null);
    setQ("");
    setMsg({ tone: "success", text: `✓ #${formatStorageNo(r.no)} ${r.plate} ${r.owner} → 더미 ${r.stackNo ?? ""} (새로 등록${r.reused ? " · 이미 있던 차" : ""})` });
    try {
      navigator.vibrate?.(30);
    } catch {
      /* 무시 */
    }
  };

  const notHere = async (s: SetLite) => {
    if (!(await ask({ title: `${s.plate ?? ""} ${s.owner} — 창고에 없나요?`, body: "실사 후보에서 뺍니다(기록은 남습니다).", confirmLabel: "창고에 없음", tone: "danger" }))) return;
    start(async () => {
      const r = await dismissCandidate(s.id);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setSets((all) => all.filter((x) => x.id !== s.id));
      setMsg({ tone: "success", text: `${s.plate ?? ""} — 창고에 없음 처리` });
    });
  };

  if (!ready) return <p className="mt-6 text-center text-slate-500">불러오는 중…</p>;
  if (rooms.length === 0) return <Notice tone="warn">구역이 없습니다 — 「🗺 구역」 탭에서 구역을 먼저 만들어 주세요.</Notice>;

  return (
    <div className="mt-2 pb-28">
      {confirmNode}

      {/* 지금 위치 — 고정 */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur lg:top-28">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-lg font-extrabold leading-tight text-slate-900">
            📍 {chosenText(areas, loc, sets) ?? <span className="text-amber-700">위치를 고르세요</span>}
          </p>
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="min-h-11 shrink-0 rounded-control border-2 border-slate-900 px-3 text-sm font-bold">
              바꾸기
            </button>
          )}
        </div>
        <p className="tabular text-sm text-slate-700">
          오늘 <strong>{done.length}</strong> · 실사 전 남음 <strong>{stats.pending}</strong> · 위치 없음 <strong>{stats.unplaced}</strong>
        </p>
      </div>

      {open ? (
        <div className="mt-3">
          <LocationChooser areas={areas} sets={sets} value={loc} onChange={changeLoc} />
          {complete && (
            <button type="button" onClick={startHere} className="mt-3 min-h-14 w-full rounded-control bg-slate-900 text-lg font-bold text-white">
              이 더미에서 실사 시작
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ⭐ 더미 그림 (5차) — 쌓인 모양 · 몇 본 · 누구 것. 더미를 누르면 거기로, 「다음 더미 →」 한 번으로 넘어간다 */}
          {area && plan && loc.slotId && (
            <div className="mt-3 rounded-card border-2 border-slate-900 p-3">
              <StackStrip sets={slotSets} count={shownCount} current={curStack} onPick={(no) => changeLoc({ ...loc, stack: no })} onCount={(n) => {
                setCount(n);
                if (curStack > n) changeLoc({ ...loc, stack: n });
              }} />
              <button
                type="button"
                onClick={nextStack}
                className="mt-2 min-h-14 w-full rounded-control bg-slate-900 text-lg font-extrabold text-white active:bg-slate-700"
              >
                이 더미 다 쌓음 → 다음 더미 {curStack + 1}
              </button>
            </div>
          )}

          {/* 찾기 */}
          <div className="mt-3 flex gap-2">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => setTimeout(() => setTyping(false), 150)}
              inputMode={hangul ? "text" : "numeric"}
              placeholder={hangul ? "이름 · 차번호" : "타이어에 적힌 차번호 끝 4자리"}
              className="min-w-0 flex-1 rounded-control border-2 border-slate-900 bg-white px-4 py-3 text-xl font-bold placeholder:text-base placeholder:font-normal placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setHangul((h) => !h);
                setTimeout(() => inputRef.current?.focus(), 30);
              }}
              className="min-h-12 shrink-0 rounded-control border-2 border-slate-300 px-3 text-sm font-bold"
            >
              {hangul ? "123" : "가나다"}
            </button>
          </div>

          {/* 되돌리기는 검색칸 바로 아래 — 키보드가 열려도 보이고 「여기 ✓」 를 가리지 않는다 */}
          {undo ? (
            <div className="mt-2 flex items-center gap-2 rounded-card bg-slate-900 px-3 py-2 text-white">
              <span className="min-w-0 flex-1 text-sm">✓ {undo.label}</span>
              <button type="button" onClick={doUndo} className="min-h-11 shrink-0 rounded-control bg-white px-3 text-sm font-bold text-slate-900">
                되돌리기
              </button>
            </div>
          ) : (
            msg && (
              <Notice tone={msg.tone} className="text-base">
                {msg.text}
              </Notice>
            )
          )}

          <div className="mt-2 divide-y divide-slate-200">
            {results.map((s) => {
              const isHere = here(s);
              const where = s.areaId != null && !isHere ? whereText(s) : null;
              return (
                <div key={s.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-extrabold leading-tight">
                      {s.plate ?? "차량 없음"} <span className="text-base font-semibold text-slate-700">{s.owner}</span>
                    </p>
                    <p className="text-sm text-slate-800">
                      {s.status === "확인대기" ? <span className="font-bold text-amber-800">실사 전 · </span> : <span className="tabular font-bold">#{formatStorageNo(s.no)} · </span>}
                      {labelKind(s.kind)} {s.describe}
                    </p>
                    {where && <p className="text-sm font-semibold text-blue-800">지금 기록: {where}</p>}
                    {s.status === "확인대기" && (
                      <button type="button" onClick={() => notHere(s)} className="mt-1 min-h-9 text-sm font-semibold text-slate-600 underline">
                        창고에 없음
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busyId != null || isHere}
                    onClick={() => place(s)}
                    className="min-h-14 min-w-24 shrink-0 rounded-control bg-brand-600 px-4 text-lg font-extrabold text-white disabled:bg-slate-300 disabled:text-slate-700"
                  >
                    {isHere ? "✓ 여기" : busyId === s.id ? "…" : where ? "여기로" : "여기 ✓"}
                  </button>
                </div>
              );
            })}
            {q && results.length > 0 && found === null && (
              <button type="button" onClick={() => setFound(q)} className="block min-h-12 w-full py-3 text-center text-base font-bold text-slate-800 underline">
                이 중에 없음 — 처음 보는 세트 등록
              </button>
            )}
            {q && results.length === 0 && found === null && (
              <div className="py-3 text-center">
                <p className="text-base text-slate-700">찾는 세트가 없습니다</p>
                <button
                  type="button"
                  onClick={() => setFound(q)}
                  className="mt-2 min-h-14 w-full rounded-control bg-slate-900 text-lg font-extrabold text-white"
                >
                  처음 보는 세트 — 여기서 등록
                </button>
              </div>
            )}
          </div>
          {found !== null && complete && (
            <FoundSetForm
              initialQuery={found}
              loc={{ areaId: loc.areaId!, slotId: loc.slotId!, stack: loc.stack! }}
              locText={chosenText(areas, loc, sets)}
              today={today}
              onDone={foundDone}
              onCancel={() => setFound(null)}
            />
          )}
        </>
      )}

      {/* 오늘 한 것 스티커 — 검색 중(키보드)엔 숨김 */}
      <div className={`fixed inset-x-0 bottom-16 z-30 mx-auto max-w-2xl px-4 lg:bottom-3 ${typing ? "hidden" : ""}`}>
        {done.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-card border border-slate-300 bg-white px-4 py-2 shadow">
            <span className="text-sm">
              오늘 한 것 <strong>{done.length}</strong>세트
            </span>
            <a
              href={`/print/storage?ids=${done.join(",")}`}
              target="_blank"
              className="inline-flex min-h-11 items-center rounded-control bg-slate-900 px-4 text-sm font-semibold text-white"
            >
              스티커 인쇄
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
