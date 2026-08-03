"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StockLot } from "@/lib/stock";
import { setDotQty } from "@/lib/stock";
import { SEASON_STYLE, type Season } from "@/lib/tire-attrs";

/** 오늘 안에 확인한 것인가 — 실사는 보통 하루에 한 바퀴 돈다 */
function checkedToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

/** 1826 → '26년 18주' */
function dotLabel(dot: string): string {
  return `${dot.slice(2, 4)}년 ${Number(dot.slice(0, 2))}주`;
}

const key = (l: StockLot) => `${l.productId}|${l.dot ?? ""}`;

/**
 * 창고를 돌면서 하나씩 세는 화면.
 *
 * 「맞음」이 기본 동작이다 — 대부분은 장부와 맞고, 맞을 때 손이 제일 적게 가야 한다.
 * 틀렸을 때만 「고치기」로 숫자를 연다.
 */
export function Stocktake({ lots }: { lots: StockLot[] }) {
  /** 이번에 확인한 묶음 — 서버를 다시 안 불러도 화면이 바로 반응해야 한다 */
  const [done, setDone] = useState<Record<string, number>>(() =>
    Object.fromEntries(lots.filter((l) => checkedToday(l.verifiedAt)).map((l) => [key(l), l.qty])),
  );
  const [onlyLeft, setOnlyLeft] = useState(false);

  const left = lots.filter((l) => done[key(l)] === undefined);
  const shown = onlyLeft ? left : lots;

  /** 인치별로 갈라 놓는다 — 창고가 인치로 정리돼 있다 */
  const byRim = new Map<number | null, StockLot[]>();
  for (const l of shown) {
    const arr = byRim.get(l.rimInch) ?? [];
    arr.push(l);
    byRim.set(l.rimInch, arr);
  }

  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mt-4 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="tabular text-sm font-semibold text-slate-700">
            {lots.length - left.length} / {lots.length} 확인
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${lots.length ? ((lots.length - left.length) / lots.length) * 100 : 0}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyLeft((v) => !v)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
              onlyLeft ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"
            }`}
          >
            남은 것만
          </button>
        </div>
      </div>

      {shown.length === 0 && (
        <p className="mt-8 text-center text-slate-500">
          {onlyLeft ? "다 세셨습니다 👍" : "재고가 없습니다"}
        </p>
      )}

      {[...byRim.entries()].map(([rim, group]) => (
        <section key={String(rim)} className="mt-5">
          <h2 className="tabular mb-2 text-sm font-bold text-slate-500">
            {rim === null ? "규격 미상" : `${rim}인치`}
            <span className="ml-2 font-normal">{group.reduce((s, l) => s + l.qty, 0)}본</span>
          </h2>
          <ul className="space-y-2">
            {group.map((l) => (
              <LotRow
                key={key(l)}
                lot={l}
                confirmed={done[key(l)]}
                onDone={(qty) => setDone((d) => ({ ...d, [key(l)]: qty }))}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const BTN = "h-12 w-12 shrink-0 rounded-xl border border-slate-300 bg-white text-2xl font-bold active:bg-slate-100";

function LotRow({
  lot,
  confirmed,
  onDone,
}: {
  lot: StockLot;
  confirmed: number | undefined;
  onDone: (qty: number) => void;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lot.qty);
  const [error, setError] = useState<string | null>(null);
  const shownQty = confirmed ?? lot.qty;
  const isDone = confirmed !== undefined;
  const changed = isDone && confirmed !== lot.qty;

  function save(qty: number) {
    setError(null);
    start(async () => {
      const r = await setDotQty({ productId: lot.productId, dot: lot.dot, qty, reason: "실사" });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      onDone(qty);
    });
  }

  const old = lot.ageYears !== null && lot.ageYears >= 2;

  return (
    <li
      className={`rounded-xl border p-3 ${
        isDone ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="tabular flex flex-wrap items-baseline gap-x-2">
            <span className="text-lg font-bold">{lot.spec ?? "규격 미상"}</span>
            {lot.loadSpeed && <span className="text-sm text-slate-500">{lot.loadSpeed}</span>}
            {lot.season && (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEASON_STYLE[lot.season as Season] ?? "bg-slate-100 text-slate-600"}`}
              >
                {lot.season}
              </span>
            )}
          </div>
          <Link
            href={`/stock/${lot.productId}`}
            className="mt-0.5 block truncate text-sm text-slate-600 underline decoration-slate-300 underline-offset-4"
          >
            {lot.model}
          </Link>
          <div className="tabular mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            {lot.dot ? (
              <span className={old ? "font-semibold text-amber-700" : "text-slate-500"}>
                DOT {lot.dot} · {dotLabel(lot.dot)}
                {old && ` · ${lot.ageYears}년 지남`}
              </span>
            ) : (
              <span className="font-semibold text-amber-700">DOT 없음</span>
            )}
          </div>
        </div>

        {/* 장부 수량 — 세는 동안 계속 보여야 한다 */}
        <div className="tabular shrink-0 text-right">
          <div className="text-2xl font-bold">
            {shownQty}
            <span className="ml-0.5 text-sm font-medium text-slate-500">본</span>
          </div>
          {changed && <div className="text-xs text-amber-700">장부 {lot.qty}본이었음</div>}
        </div>
      </div>

      {editing ? (
        <div className="mt-3">
          <div className="flex items-center justify-end gap-2">
            <button className={BTN} onClick={() => setValue((v) => Math.max(0, v - 1))} disabled={pending}>
              −
            </button>
            <input
              value={value}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
              inputMode="numeric"
              aria-label="실제 수량"
              className="tabular h-12 w-16 shrink-0 rounded-xl border border-slate-300 text-center text-2xl font-bold"
            />
            <button className={BTN} onClick={() => setValue((v) => v + 1)} disabled={pending}>
              +
            </button>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setValue(lot.qty);
                setEditing(false);
              }}
              className="rounded-lg px-4 py-2 text-slate-500"
            >
              취소
            </button>
            <button
              onClick={() => save(value)}
              disabled={pending}
              className="rounded-lg bg-slate-900 px-5 py-2 font-medium text-white disabled:opacity-50"
            >
              {pending ? "저장 중…" : value === lot.qty ? "확정" : `${lot.qty} → ${value} 확정`}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => save(lot.qty)}
            disabled={pending || isDone}
            className={`flex-1 rounded-xl py-3 font-semibold ${
              isDone
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-900 text-white active:bg-slate-700 disabled:opacity-50"
            }`}
          >
            {isDone ? "확인함 ✓" : pending ? "…" : `맞음 · ${lot.qty}본`}
          </button>
          <button
            onClick={() => {
              setValue(shownQty);
              setEditing(true);
            }}
            className="rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-600 active:bg-slate-100"
          >
            고치기
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}
