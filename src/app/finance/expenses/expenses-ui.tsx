"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { EXPENSE_CATS } from "@/lib/expense-cats";
import type { ExpenseData, ExpenseRow, RelatedTxn } from "@/lib/recon-data";
import { previewUnset, setExpenseCategory } from "@/lib/fin-expense";
import { won } from "@/components/fin/money";

/**
 * ⭐ 「이게 무슨 돈인가」 단서 (사장님 지적 2026-08-27)
 *
 *   "지출 부분에서 이렇게만 보니까 정확히 뭘로 분류해야할지 알기가 어려워."
 *
 * 같은 상대의 다른 기록을 나란히 놓는다. 특히 **같은 금액이 반대로 오간 짝**은
 * 거의 언제나 「받았던 돈을 돌려줬다」이다 — 사장님이 말로 알려주셔야 했던
 * 박성준(제이) 예약금 반환이 정확히 이 모양이었다(07-21 입금 → 07-26 출금).
 */
function Clues({ row }: { row: ExpenseRow }) {
  const mirror = row.related.find((x) => x.amount === row.amount);
  if (!row.what && !row.taxParty && row.related.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1 text-xs leading-relaxed">
      {row.what && <p className="text-slate-500">※ {row.what}</p>}
      {/* 계산서 발행처와 이름이 맞으면 매입처다 — 미분류 4.16억 중 1.7억이 이것이었다 */}
      {row.taxParty && (
        <p className="rounded-lg bg-sky-50 px-2 py-1 text-sky-900">
          「{row.taxParty}」 에게 <strong>세금계산서를 받은 적이 있습니다</strong> — 사업자 거래처입니다.
          타이어·부품을 산 것이면 매입대금, 광고·기장료 같은 것이면 그에 맞는 분류를 골라 주세요.
        </p>
      )}
      {mirror && (
        <p className="rounded-lg bg-amber-50 px-2 py-1 text-amber-900">
          {mirror.at} 에 같은 이름으로 <strong>{won(mirror.amount)}원이 들어왔습니다</strong>
          {mirror.category ? ` (${mirror.category})` : ""} — 받았던 돈을 돌려준 것일 수 있습니다.
        </p>
      )}
      {row.related.length > 0 && (
        <ul className="tabular space-y-0.5 text-slate-400">
          {row.related.map((x: RelatedTxn) => (
            <li key={x.id}>
              ↔ {x.at} {x.amount > 0 ? "들어옴" : "나감"} {won(Math.abs(x.amount))}원
              {x.category ? ` · ${x.category}` : " · 분류 안 됨"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** ⭐ 지출 분류 화면 (ERP ⑥, 2026-08-25) — 제안 원터치 + 분류 고르기 */
export function ExpensesUi({ data, ym }: { data: ExpenseData; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 줄마다 고른 분류 (셀렉트) */
  const [pick, setPick] = useState<Record<number, string>>({});
  /**
   * ⭐ 해제를 누른 줄 — 「이 줄만 / N건 전부」를 고르는 중 (2회차 수리 A5, 2026-08-28)
   *
   * 🔴 전에는 해제가 **말없이 그 한 줄만** 풀었다. 붙일 때는 같은 상대의 전 기간에
   *    한꺼번에 붙는데도. 그래서 사장님이 "고쳤다"고 생각한 뒤에도 나머지가 그대로 남아
   *    손익에 계속 들어갔다. 이제 누를 때마다 몇 건인지 세어 물어본다.
   */
  const [unset, setUnset] = useState<
    { id: number; payer: string; category: string; n: number; sum: number } | null
  >(null);

  /** 해제 눌렀을 때 — 1건뿐이면 바로 풀고, 여러 건이면 물어본다 */
  const askUnset = (id: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const p = await previewUnset(id);
      if (!p.ok) return setError(p.error);
      if (p.n <= 1) return doUnset(id, "one");
      setUnset({ id, payer: p.payer, category: p.category, n: p.n, sum: p.sum });
    });

  const doUnset = (id: number, scope: "one" | "all") =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await setExpenseCategory(id, null, { scope });
      setUnset(null);
      if (!r.ok) return setError(r.error);
      setMsg(
        `「${r.payer}」 분류를 ${r.applied}건 풀었습니다 — 규칙도 지워 앞으로 자동으로 붙지 않습니다.` +
          (scope === "one" ? " (이 줄만 — 같은 상대의 나머지는 그대로입니다)" : ""),
      );
      router.refresh();
    });

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

      {/*
        🔴 감사 M5 — 한 상대를 붙이면 그 상대 전체(과거 포함)에 전파된다.

        🔴 사장님 지적(2026-08-27): "무슨 기능인지도 잘 모르겠음. 필요한거임?"
           1건짜리까지 담는 바람에 **아래 목록과 똑같은 목록이 위에 한 번 더** 있었다.
           이제 `recon-data` 가 2건 이상만 담는다 — 7월처럼 겹치는 상대가 없는 달엔
           이 칸 자체가 안 나온다. 6월(103건)·1월(88건)처럼 같은 상대가 여러 번인
           달에는 한 번에 붙일 수 있어 이 칸이 훨씬 빠르다.
      */}
      {data.byPayer.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">
            같은 상대 여러 건 — 한 번에 붙이기
            <span className="ml-2 text-xs font-normal text-slate-500">
              이 달에 두 번 이상 나온 상대입니다. 한 번 붙이면 그 상대의 과거 것까지 같이 붙습니다.
            </span>
          </h2>
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
          분류 안 된 지출 <strong>{data.unclassifiedCount}건 · {won(data.unclassifiedTotal)}원</strong>
          {data.unclassifiedCount > data.unclassified.length ? ` (금액 큰 ${data.unclassified.length}건부터 표시)` : ""}
        </span>
      </section>

      {data.unclassified.length === 0 ? (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.monthOutCount === 0 ? (
            <>
              {Number(ym.slice(5, 7))}월 통장·카드 내역이 아직 안 올라왔습니다 —{" "}
              <Link href={`/finance/upload?ym=${ym}`} className="underline">내역 올리기</Link>
            </>
          ) : (
            <>
              {Number(ym.slice(5, 7))}월 지출은 모두 분류됐습니다 🎉 — 다음은{" "}
              <Link href={`/finance/tax?view=money&ym=${ym}`} className="font-semibold underline">세금계산서 돈 확인 →</Link>
            </>
          )}
        </section>
      ) : (
        <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
          {data.unclassified.map((row) => (
            <li key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <span className="tabular text-xs text-slate-400">{row.at}</span>{" "}
                  <span className="text-xs text-slate-400">{row.source === "법인카드" ? "💳" : "🏦"}</span>{" "}
                  {row.via && (
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {row.via}
                    </span>
                  )}
                  <span className="font-medium">{row.payer}</span>
                  {row.place && <span className="ml-1 text-xs text-slate-400">{row.place}</span>}
                </span>
                <span className="tabular shrink-0 font-bold text-red-600">−{won(row.amount)}원</span>
              </div>

              <Clues row={row} />

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

              {/*
                원문을 접어 둔다 — 이름만으로 모를 때 여는 곳이다.
                사업자번호가 있으면 홈택스·검색으로 확인할 수 있어 가장 확실한 단서다.
              */}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs text-slate-400">자세히</summary>
                <dl className="tabular mt-1 space-y-0.5 text-xs text-slate-500">
                  <div>
                    <dt className="inline text-slate-400">어디서 </dt>
                    <dd className="inline">{row.label}</dd>
                  </div>
                  <div>
                    <dt className="inline text-slate-400">원문 </dt>
                    <dd className="inline break-all">{row.description}</dd>
                  </div>
                  {row.bizNo && (
                    <div>
                      <dt className="inline text-slate-400">사업자번호 </dt>
                      <dd className="inline">{row.bizNo}</dd>
                    </div>
                  )}
                  {row.approvalNo && (
                    <div>
                      <dt className="inline text-slate-400">승인번호 </dt>
                      <dd className="inline">{row.approvalNo}</dd>
                    </div>
                  )}
                </dl>
              </details>
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
                {/* 🔴 2회차 수리 A5: 여러 건이면 「이 줄만 / 전부」를 고른다 (위 unset 주석 참고) */}
                {unset?.id === row.id ? (
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <span className="text-xs text-slate-500">
                      같은 상대 {unset.n}건({won(unset.sum)}원)
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => doUnset(row.id, "one")}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
                    >
                      이 줄만
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => doUnset(row.id, "all")}
                      className="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {unset.n}건 전부
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnset(null)}
                      className="px-1 text-xs text-slate-400 underline"
                    >
                      그만
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => askUnset(row.id)}
                    className="shrink-0 text-xs text-slate-400 underline"
                  >
                    해제
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 text-xs text-slate-400">
        매입대금·카드대금·내부이체로 분류한 지출은 손익의 「쓴 돈」에 다시 넣지 않습니다 — 매입·법인카드
        쪽에서 이미 세고 있어 이중 계산이 되기 때문입니다.
      </p>
      <p className="mt-2 text-sm">
        다음 단계:{" "}
        <Link href={`/finance/tax?view=money&ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          세금계산서 돈 확인 →
        </Link>
      </p>
    </>
  );
}
