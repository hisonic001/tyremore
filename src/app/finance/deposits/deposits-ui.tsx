"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DepositReconData, DepositSuggestion } from "@/lib/recon-data";
import { collectFromDeposit, ignoreDeposit, linkDepositToQuote, markCardSettlements, unmarkCardSettlement } from "@/lib/fin-deposits";

const won = (n: number) => n.toLocaleString("ko-KR");

/** ⭐ 통장 입금을 카드 정산·이체 판매·외상 수금으로 정리 (ERP 4단계, 2026-08-24) */
export function DepositsRecon({ data, ym }: { data: DepositReconData; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: (r: never) => string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(String((r as { error?: string }).error ?? "실패했습니다"));
      setMsg(okMsg(r as never));
      router.refresh();
    });

  const collect = (s: DepositSuggestion, key: string, label: string, remain: number) => {
    const take = Math.min(s.dep.amount, remain);
    if (
      !confirm(
        `${label}의 외상을 ${won(take)}원 수금으로 등록할까요?\n(오래된 건부터 차례로 채웁니다${
          s.dep.amount > remain ? ` — 입금이 잔액보다 커서 ${won(s.dep.amount - remain)}원이 남습니다` : ""
        })`,
      )
    )
      return;
    act(
      () => collectFromDeposit(s.dep.id, key),
      (r: { applied: number; settled: number; leftover: number }) =>
        `수금 ${won(r.applied)}원 등록 — ${r.settled}건 완납${r.leftover > 0 ? ` · 남은 ${won(r.leftover)}원은 배분 안 됨` : ""}`,
    );
  };

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}

      {/* 카드 정산 일괄 */}
      {data.cardPatternCount > 0 && (
        <section className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
          <p className="text-sm text-sky-900">
            카드 정산으로 보이는 입금(적요 FB자금·매출표)이{" "}
            <strong className="tabular">
              {data.cardPatternCount}건 · {won(data.cardPatternSum)}원
            </strong>{" "}
            있습니다
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => markCardSettlements(ym),
                (r: { marked: number }) => `${r.marked}건을 카드 정산으로 표시했습니다.`,
              )
            }
            className="mt-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            모두 카드 정산으로 표시
          </button>
        </section>
      )}

      <section className="mt-4 flex items-center justify-between text-sm">
        <span className="tabular">
          정리할 입금 <strong>{data.open.length}건</strong> · 정리됨 {data.doneCount}건 · 무시 {data.ignoredCount}건
        </span>
      </section>

      {data.open.length === 0 && data.cardPatternCount === 0 && (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          이 달은 정리할 입금이 없습니다.
        </section>
      )}

      <ul className="mt-2 space-y-3">
        {data.open.map((s) => (
          <li key={s.dep.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="tabular text-xs text-slate-400">{s.dep.at}</span>{" "}
                <span className="font-medium">{s.dep.description}</span>
              </span>
              <span className="tabular shrink-0 font-bold text-emerald-700">+{won(s.dep.amount)}원</span>
            </div>

            {s.taxHint && (
              <p className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-800">
                ★ {s.taxHint} — 세금계산서 대조 화면에서 그 계산서와 이으면 정리됩니다
              </p>
            )}
            {s.parties.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">
                <p className="text-xs text-amber-900">이름이 닮은 외상 대상 — 수금이면 바로 등록하세요</p>
                <ul className="mt-1 space-y-1">
                  {s.parties.map((p) => (
                    <li key={p.key} className="flex items-center justify-between gap-2">
                      <span className="tabular min-w-0 truncate text-xs">
                        {p.label} · 잔액 {won(p.remain)}원 ({p.count}건)
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => collect(s, p.key, p.label, p.remain)}
                        className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        수금 등록
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.quotes.length > 0 && (
              <div className="mt-2 text-sm">
                <p className="text-xs text-slate-500">같은 금액의 계좌이체 판매 — 같은 건이면 이으세요</p>
                <ul className="mt-1 space-y-1">
                  {s.quotes.map((q) => (
                    <li key={q.quoteId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs">{q.label}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          act(() => linkDepositToQuote(s.dep.id, q.quoteId), () => "이었습니다.")
                        }
                        className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium"
                      >
                        잇기
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {s.parties.length === 0 && s.quotes.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">
                이을 만한 판매·외상을 못 찾았습니다 — 판매와 무관한 입금(지원금·이자 등)이면 무시하세요
              </p>
            )}

            <div className="mt-2 text-right">
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => ignoreDeposit(s.dep.id), () => "무시했습니다.")}
                className="text-xs text-slate-400 underline"
              >
                무시
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* 🔴 감사 H10 — 카드정산으로 표시된 입금 되돌리기 (우연히 패턴에 걸린 진짜 입금 구제) */}
      {data.settledCard.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            카드정산으로 표시된 입금 {data.settledCard.length}건 (이 달) — 잘못 표시됐으면 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.settledCard.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.at} · {r.payer} · +{won(r.amount)}원
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => unmarkCardSettlement(r.id), () => "되돌렸습니다 — 정리 목록으로 돌아갔습니다.")}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-4 text-xs text-slate-400">
        수금 등록을 되돌리려면 정비 내역·외상 장부의 수금 내역에서 지우면 됩니다 — 여기 연결 자국은
        장부와 별개의 표시일 뿐입니다.
      </p>
    </>
  );
}
