"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAttrs, saveAttrs, type EditableAttrs } from "@/lib/attrs";
import { SEASON_ORDER, SEASON_STYLE, type Season } from "@/lib/tire-attrs";

/**
 * ⭐ 세부사항 고치기 (사장님 요청 2026-08-01)
 *
 * 자동 판정은 상품명에서 읽는데, MARS 이름이 축약·누락투성이라 틀린 것이 많다.
 * 여기서 고친 값은 **재이관해도 유지된다** (attrs_override).
 */

/** 자주 쓰는 OE 마킹 — 어느 차 순정인가 */
const OE_OPTIONS: [string, string][] = [
  ["MO", "벤츠"],
  ["MO1", "벤츠 AMG"],
  ["MOE", "벤츠 런플랫"],
  ["★", "BMW"],
  ["AO", "아우디"],
  ["RO1", "아우디 콰트로"],
  ["N", "포르쉐"],
  ["VOL", "볼보"],
  ["GOE", "제네시스"],
  ["K", "페라리"],
  ["T0", "테슬라"],
  ["LR", "랜드로버"],
  ["MGT", "마세라티"],
  ["GRNX", "저연비"],
];

/** 겹수 — 승용 4겹, 경상용 6~12겹. 트럭(14겹 이상)은 여기서 안 고른다 */
const PLY_OPTIONS = [4, 6, 8, 10, 12] as const;

const CHIP = "rounded-full border px-3 py-2 text-sm font-medium transition-colors";
const ON = "border-slate-900 bg-slate-900 text-white";
const OFF = "border-slate-300 bg-white text-slate-600";

export function AttrsEditor({
  productId,
  current,
  edited,
}: {
  productId: number;
  current: EditableAttrs;
  /** 사람이 고친 적이 있는가 */
  edited: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [season, setSeason] = useState<Season | null>(current.season);
  const [runflat, setRunflat] = useState(current.isRunflat);
  const [acoustic, setAcoustic] = useState(current.isAcoustic);
  const [suv, setSuv] = useState(current.isSuv);
  const [oe, setOe] = useState<string[]>(
    current.oeMarks ? current.oeMarks.split(",").map((s) => s.trim()).filter(Boolean) : [],
  );
  const [ply, setPly] = useState<number | null>(current.plyRating ?? null);

  const dirty =
    season !== current.season ||
    runflat !== current.isRunflat ||
    acoustic !== current.isAcoustic ||
    suv !== current.isSuv ||
    oe.join(",") !== (current.oeMarks ?? "") ||
    ply !== (current.plyRating ?? null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-600 active:bg-slate-100"
      >
        세부사항 고치기 {edited && <span className="text-xs text-slate-400">· 고친 적 있음</span>}
      </button>
    );
  }

  return (
    <section className="mt-3 rounded-2xl border-2 border-slate-900 bg-white p-4">
      <h2 className="font-bold">세부사항</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        상품명에서 자동으로 읽은 값입니다. 틀린 것을 고치면 <strong>다음 이관에도 유지됩니다.</strong>
      </p>

      <div className="mt-3">
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700">계절</h3>
        <div className="flex flex-wrap gap-2">
          {SEASON_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeason(season === s ? null : s)}
              className={`${CHIP} ${season === s ? SEASON_STYLE[s] + " border-transparent font-bold" : OFF}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700">구조·기능</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setRunflat((v) => !v)} className={`${CHIP} ${runflat ? ON : OFF}`}>
            런플랫
          </button>
          <button type="button" onClick={() => setAcoustic((v) => !v)} className={`${CHIP} ${acoustic ? ON : OFF}`}>
            흡음재
          </button>
          <button type="button" onClick={() => setSuv((v) => !v)} className={`${CHIP} ${suv ? ON : OFF}`}>
            SUV
          </button>
        </div>
      </div>

      <div className="mt-3">
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
          겹수 <span className="font-normal text-slate-400">승용은 대개 4겹 · 상용은 6겹부터</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {PLY_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPly((v) => (v === n ? null : n))}
              className={`${CHIP} ${ply === n ? ON : OFF}`}
            >
              {n}겹
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
          OE 마킹 <span className="font-normal text-slate-400">어느 차 순정인가</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {OE_OPTIONS.map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setOe((v) => (v.includes(code) ? v.filter((x) => x !== code) : [...v, code]))}
              className={`${CHIP} ${oe.includes(code) ? "border-amber-600 bg-amber-100 font-bold text-amber-900" : OFF}`}
            >
              {code} <span className="text-xs opacity-70">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await saveAttrs(productId, {
                season,
                isRunflat: runflat,
                isAcoustic: acoustic,
                isSuv: suv,
                oeMarks: oe.length ? oe.join(",") : null,
              });
              if (!r.ok) setError(r.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="flex-1 rounded-xl bg-slate-900 py-3 font-semibold text-white disabled:opacity-40"
        >
          {pending ? "저장 중…" : dirty ? "저장" : "바뀐 것 없음"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-slate-500">
          닫기
        </button>
      </div>

      {edited && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await resetAttrs(productId);
              if (!r.ok) setError(r.error);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
          className="mt-2 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-500"
        >
          자동 판정으로 되돌리기
        </button>
      )}
    </section>
  );
}
