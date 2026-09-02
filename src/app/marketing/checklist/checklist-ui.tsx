"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import { shotsFor, WORK_KINDS, type Act, type WorkKind } from "@/lib/photo-checklist";

const ACT_LABEL: Record<Act, string> = {
  A: "입고·진단",
  B: "작업",
  C: "출고·확인",
};

/**
 * 폰으로 보면서 찍는 화면. 체크는 이 화면에서만 산다 (저장하지 않는다) —
 * 한 건 찍는 동안만 쓰는 것이라 서버에 남길 이유가 없다.
 */
export function ChecklistUI() {
  const [kind, setKind] = useState<WorkKind>("타이어 교체");
  const [ev, setEv] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  const shots = useMemo(() => shotsFor(kind, ev), [kind, ev]);
  const musts = shots.filter((s) => s.must);
  const mustLeft = musts.filter((s) => !done.has(s.slot)).length;

  const toggle = (slot: string) =>
    setDone((p) => {
      const n = new Set(p);
      if (n.has(slot)) n.delete(slot);
      else n.add(slot);
      return n;
    });

  const acts: Act[] = ["A", "B", "C"];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {WORK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setDone(new Set());
            }}
            className={`min-h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              kind === k
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-600 active:bg-slate-100"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
        <input
          type="checkbox"
          checked={ev}
          onChange={(e) => {
            setEv(e.target.checked);
            setDone(new Set());
          }}
          className="size-5"
        />
        전기차입니다 (잭패드 등 3컷이 더 붙습니다)
      </label>

      <div className="mt-3 flex items-center gap-2 rounded-card bg-slate-50 px-3 py-2">
        <span className="text-sm font-semibold">
          모두 {shots.length}컷 · 찍은 것 {done.size}
        </span>
        {mustLeft > 0 ? (
          <StatusPill tone="accent">꼭 찍을 것 {mustLeft}개 남음</StatusPill>
        ) : (
          <StatusPill tone="success">꼭 찍을 것 다 찍음</StatusPill>
        )}
      </div>

      {acts.map((a) => {
        const list = shots.filter((s) => s.act === a);
        if (list.length === 0) return null;
        return (
          <section key={a} className="mt-5">
            <h2 className="text-sm font-bold text-slate-700">
              {a}. {ACT_LABEL[a]}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {list.map((s) => {
                const on = done.has(s.slot);
                return (
                  <li key={s.slot}>
                    <button
                      type="button"
                      onClick={() => toggle(s.slot)}
                      className={`flex w-full items-start gap-3 rounded-card border p-3 text-left transition-colors ${
                        on ? "border-brand-200 bg-brand-50" : "border-slate-200 bg-white active:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                          on ? "bg-brand-600 text-white" : "border border-slate-300 text-transparent"
                        }`}
                      >
                        <Check className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-slate-400">{s.slot}</span>
                          <span className={`font-medium leading-snug ${on ? "text-slate-400 line-through" : ""}`}>
                            {s.label}
                          </span>
                          {s.must && <StatusPill tone="accent">꼭</StatusPill>}
                        </span>
                        {s.why && (
                          <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{s.why}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="mt-6 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm leading-snug text-amber-900">
        <h2 className="font-bold">찍을 때 두 가지만</h2>
        <p className="mt-1">
          ① <strong>차량 정면·후면은 번호판을 가려서</strong> 찍으세요 (지금 하시는 그대로입니다).
        </p>
        <p className="mt-1">
          ② <strong>숫자가 찍힌 화면</strong>은 흔들리지 않게. 밸런스 측정값·토크렌치 다이얼·계기판
          주행거리가 글의 신뢰를 만듭니다. 지금 폴더에서 가장 자주 빠지는 것도 이것입니다.
        </p>
      </section>
    </div>
  );
}
