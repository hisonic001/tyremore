"use client";

/**
 * ⭐ 기간 필터 정본 (정비 내역 2026-08-05 → 공용으로 2026-08-29)
 *
 *   "필터를 둬서 날짜기간별, 월별, 오늘 등으로 보이게 하며 default 값은 오늘 정비내역."
 *   그리고 매입 내역에도 같은 것을 (사장님 요청 2026-08-29 —
 *   "정비내역에서처럼 날짜 필터링이 필요함").
 *
 * 🔴 **한 벌만 둔다.** 화면마다 따로 만들면 「오늘」의 뜻이 갈린다 —
 *    이 저장소가 되풀이해 데인 자리다(같은 값을 두 곳에서 세면 언젠가 어긋난다).
 *    전에는 `/sales` 경로가 코드에 박혀 있었고 결제수단 칩이 붙박이였다.
 *    → `basePath` 로 화면을 고르고, 화면마다 다른 칩 줄은 `extra` 슬롯으로 넣는다.
 *
 *   range 값: 'today' | 'yesterday' | 'thisMonth' | 'all' | 'month' | 'range'
 *   화면 쪽 해석은 `sales/page.tsx` · `receiving/history/page.tsx` 가 같은 규칙으로 한다.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PeriodFilter({
  basePath,
  months,
  active,
  month,
  from,
  to,
  keep,
  extra,
}: {
  /** 어느 화면의 쿼리인가 — '/sales' · '/receiving/history' */
  basePath: string;
  months: string[];
  /** 'today' | 'yesterday' | 'thisMonth' | 'all' | 'month' | 'range' */
  active: string;
  month: string | null;
  from: string | null;
  to: string | null;
  /** 유지할 쿼리 (화면마다 다르다 — 고객·차량·거래처·브랜드 …) */
  keep: Record<string, string | undefined>;
  /** 기간 줄 아래에 끼워 넣을 화면별 칩 줄 (정비내역의 결제수단 등) */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  const go = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    router.push(`${basePath}${p.toString() ? `?${p.toString()}` : ""}`);
  };

  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`;
  /** 기간을 바꾸면 다른 기간 값은 전부 푼다 — 섞이면 무엇으로 보고 있는지 알 수 없다 */
  const only = (r: string) => ({ range: r, month: undefined, from: undefined, to: undefined });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => go(only("today"))} className={chip(active === "today")}>
          오늘
        </button>
        {/* ⭐ 어제 (사장님 요청 2026-08-06) — 마감 뒤 전날 것을 되짚을 때 */}
        <button type="button" onClick={() => go(only("yesterday"))} className={chip(active === "yesterday")}>
          어제
        </button>
        <button type="button" onClick={() => go(only("thisMonth"))} className={chip(active === "thisMonth")}>
          이번 달
        </button>
        <button type="button" onClick={() => go(only("all"))} className={chip(active === "all")}>
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

      {/* 화면별 칩 줄 — 기간과 독립이라 겹쳐 쓸 수 있다 */}
      {extra}

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
