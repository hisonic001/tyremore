"use client";

/**
 * ⭐ 정비 내역 기간 필터 (사장님 요청 2026-08-05)
 *
 *   "필터를 둬서 날짜기간별, 월별, 오늘 등으로 보이게 하며
 *    default 값은 오늘 정비내역."
 *
 * 과거 이력 3,100건이 들어오면서 「전체」가 기본이면 화면이 무겁고 오늘 일이 묻힌다.
 * 오늘 / 이번 달 / 전체 단추 + 월 고르기 + 기간 직접 지정.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PeriodFilter({
  months,
  active,
  month,
  from,
  to,
  pay,
  payOptions,
  keep,
}: {
  months: string[];
  /** 'today' | 'yesterday' | 'thisMonth' | 'all' | 'month' | 'range' */
  active: string;
  month: string | null;
  from: string | null;
  to: string | null;
  /** ⭐ 결제 방법 필터 (사장님 요청 2026-08-07) — null 이면 전체 */
  pay: string | null;
  payOptions: readonly string[];
  /** 유지할 쿼리 (customer·vehicle·canceled + 현재 기간·결제) */
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  const go = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    router.push(`/sales${p.toString() ? `?${p.toString()}` : ""}`);
  };

  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => go({ range: "today", month: undefined, from: undefined, to: undefined })} className={chip(active === "today")}>
          오늘
        </button>
        {/* ⭐ 어제 (사장님 요청 2026-08-06) — 마감 뒤 전날 것을 되짚을 때 */}
        <button type="button" onClick={() => go({ range: "yesterday", month: undefined, from: undefined, to: undefined })} className={chip(active === "yesterday")}>
          어제
        </button>
        <button type="button" onClick={() => go({ range: "thisMonth", month: undefined, from: undefined, to: undefined })} className={chip(active === "thisMonth")}>
          이번 달
        </button>
        <button type="button" onClick={() => go({ range: "all", month: undefined, from: undefined, to: undefined })} className={chip(active === "all")}>
          전체
        </button>
        <select
          value={active === "month" && month ? month : ""}
          onChange={(e) => e.target.value && go({ month: e.target.value, range: undefined, from: undefined, to: undefined })}
          className={`tabular rounded-lg px-2 py-1.5 text-sm font-medium ${
            active === "month" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          <option value="">월 선택…</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* ⭐ 결제 방법으로 좁히기 (사장님 요청 2026-08-07) — 기간과 독립이라 겹쳐 쓸 수 있다 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-400">결제</span>
        <button type="button" onClick={() => go({ pay: undefined })} className={chip(!pay)}>
          전체
        </button>
        {payOptions.map((p) => (
          <button key={p} type="button" onClick={() => go({ pay: p })} className={chip(pay === p)}>
            {p}
          </button>
        ))}
      </div>

      {/* 기간 직접 지정 */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <input
          type="date"
          value={f}
          onChange={(e) => setF(e.target.value)}
          className={`tabular rounded-lg border px-2 py-1.5 ${active === "range" ? "border-slate-900" : "border-slate-300"}`}
        />
        <span className="text-slate-400">~</span>
        <input
          type="date"
          value={t}
          onChange={(e) => setT(e.target.value)}
          className={`tabular rounded-lg border px-2 py-1.5 ${active === "range" ? "border-slate-900" : "border-slate-300"}`}
        />
        <button
          type="button"
          disabled={!f && !t}
          onClick={() => go({ from: f || undefined, to: t || undefined, range: "range", month: undefined })}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          기간 조회
        </button>
      </div>
    </div>
  );
}
