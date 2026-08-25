"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EXPENSE_CATS } from "@/lib/expense-cats";
import type { ExpenseData, ExpenseRow } from "@/lib/recon-data";
import { setExpenseCategory } from "@/lib/fin-expense";
import { won } from "@/components/fin/money";


/** ⭐ 지출 분류 화면 (ERP ⑥, 2026-08-25) — 제안 원터치 + 분류 고르기 */
export function ExpensesUi({ data }: { data: ExpenseData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 줄마다 고른 분류 (셀렉트) */
  const [pick, setPick] = useState<Record<number, string>>({});

  const classify = (row: ExpenseRow, category: string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await setExpenseCategory(row.id, category);
      if (!r.ok) return setError(r.error);
      setMsg(
        `「${r.payer}」 → ${category}${r.applied > 1 ? ` — 같은 상대 ${r.applied}건에 한꺼번에 붙였습니다` : ""}`,
      );
      router.refresh();
    });

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}

      {/* 분류별 합계 */}
      {data.sums.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">이 달 분류별 지출</h2>
          <ul className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {data.sums.map((s) => (
              <li key={s.category} className="flex justify-between">
                <span className="text-slate-600">{s.category}</span>
                <span>{won(s.amount)}원</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 🔴 감사 M5 — 상대별 묶어 붙이기: 한 상대를 붙이면 그 상대 전체(과거 포함)에 전파된다 */}
      {data.byPayer.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">상대별 묶어 붙이기</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {data.byPayer.slice(0, 20).map((g) => (
              <li key={g.payer} className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {g.payer} · {g.n}건 · <strong>−{won(g.sum)}원</strong>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {g.suggest && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        classify({ id: g.anyId, payer: g.payer } as unknown as ExpenseRow, g.suggest!)
                      }
                      className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {g.suggest} ✓
                    </button>
                  )}
                  <select
                    value={pick[g.anyId] ?? ""}
                    onChange={(e) => setPick((p) => ({ ...p, [g.anyId]: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
                  >
                    <option value="">분류…</option>
                    {EXPENSE_CATS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={pending || !pick[g.anyId]}
                    onClick={() =>
                      classify({ id: g.anyId, payer: g.payer } as unknown as ExpenseRow, pick[g.anyId])
                    }
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    붙이기
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 flex items-center justify-between text-sm">
        <span className="tabular">
          분류 안 된 지출 <strong>{won(data.unclassifiedTotal)}원</strong>
          {data.unclassified.length < 80 ? "" : " (금액 큰 80건부터)"}
        </span>
      </section>

      {data.unclassified.length === 0 ? (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          이 달 지출은 모두 분류됐습니다 🎉
        </section>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
          {data.unclassified.map((row) => (
            <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="tabular text-xs text-slate-400">{row.at}</span>{" "}
                  <span className="text-xs text-slate-400">{row.source === "법인카드" ? "💳" : "🏦"}</span>{" "}
                  <span className="font-medium">{row.payer}</span>
                </span>
                <span className="tabular shrink-0 font-bold text-red-600">−{won(row.amount)}원</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {row.suggest && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => classify(row, row.suggest!)}
                    className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    제안: {row.suggest} ✓
                  </button>
                )}
                <select
                  value={pick[row.id] ?? ""}
                  onChange={(e) => setPick((p) => ({ ...p, [row.id]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">분류 고르기…</option>
                  {EXPENSE_CATS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !pick[row.id]}
                  onClick={() => classify(row, pick[row.id])}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  붙이기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 분류된 지출 보기/해제 — 잘못 붙였으면 여기서 (감사 H10 계열) */}
      {data.classified.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            분류된 지출 {data.classified.length}건 (이 달) — 잘못 붙였으면 해제
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.classified.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {row.at} {row.source === "법인카드" ? "💳" : "🏦"} {row.payer} · −{won(row.amount)}원 ·{" "}
                  <span className="text-violet-700">{row.category}</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setMsg(null);
                      setError(null);
                      const r = await setExpenseCategory(row.id, null);
                      if (!r.ok) return setError(r.error);
                      setMsg(`「${r.payer}」 분류를 해제했습니다 — 규칙도 지워 앞으로 자동으로 붙지 않습니다.`);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 text-xs text-slate-400">
        매입대금·카드대금·내부이체로 분류한 지출은 손익의 「쓴 돈」에 다시 넣지 않습니다 — 매입·법인카드
        쪽에서 이미 세고 있어 이중 계산이 되기 때문입니다.
      </p>
    </>
  );
}
