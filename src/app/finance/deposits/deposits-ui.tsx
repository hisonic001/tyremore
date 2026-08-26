"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { DepositReconData, DepositSuggestion } from "@/lib/recon-data";
import { collectFromDeposit, ignoreDeposit, linkDepositToQuote, markCardSettlements, undoDepositLink, unmarkCardSettlement } from "@/lib/fin-deposits";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";


/** ⭐ 통장 입금을 카드 정산·이체 판매·외상 수금으로 정리 (ERP 4단계, 2026-08-24) */
export function DepositsRecon({ data, ym }: { data: DepositReconData; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치5 — 브라우저 confirm() 대체

  const act = (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: (r: never) => string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(String((r as { error?: string }).error ?? "실패했습니다"));
      setMsg(okMsg(r as never));
      router.refresh();
    });

  const collect = async (s: DepositSuggestion, key: string, label: string, remain: number) => {
    const take = Math.min(s.dep.amount, remain);
    if (
      !(await ask({
        title: `${label} 수금으로 등록할까요?`,
        body: `외상 ${won(take)}원을 오래된 건부터 차례로 채웁니다.${
          s.dep.amount > remain ? `\n입금이 잔액보다 커서 ${won(s.dep.amount - remain)}원이 남습니다.` : ""
        }`,
        confirmLabel: "수금 등록",
      }))
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
          정리할 입금 <strong>{data.openTotal}건</strong>
          {data.openTotal > data.open.length && ` (금액 큰 ${data.open.length}건부터 표시)`} · 정리됨 {data.doneCount}건 · 무시{" "}
          {data.ignoredCount}건
        </span>
      </section>

      {/* 🔴 2026 감사 R5: 「자료 없음」과 「다 됐다」를 가른다 */}
      {data.open.length === 0 && data.cardPatternCount === 0 && (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.monthInCount === 0 ? (
            <>
              {Number(ym.slice(5, 7))}월 통장 내역이 아직 안 올라왔습니다 —{" "}
              <Link href={`/finance/upload?ym=${ym}`} className="underline">내역 올리기</Link>
            </>
          ) : (
            <>
              {Number(ym.slice(5, 7))}월 입금은 다 정리됐습니다 🎉 — 다음은{" "}
              <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold underline">지출 분류 →</Link>
            </>
          )}
        </section>
      )}

      <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
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
                        {p.key.startsWith("S:") || p.key.startsWith("C:") ? (
                          <Link
                            href={`/finance/party/${encodeURIComponent(p.key)}?ym=${ym}`}
                            className="underline-offset-2 hover:underline"
                            title="이 상대의 원장 보기"
                          >
                            {p.label}
                          </Link>
                        ) : (
                          p.label
                        )}{" "}
                        · 잔액 {won(p.remain)}원 ({p.count}건)
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
            카드정산으로 표시된 입금 {data.settledCardTotal}건 (이 달{data.settledCardTotal > data.settledCard.length ? ` · 최근 ${data.settledCard.length}건 표시` : ""}) — 잘못 표시됐으면 되돌리기
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

      {/* 🔴 2026 감사 G3 — 판매·수금과 이은 입금 되돌리기 (전에는 되돌릴 길이 없었다) */}
      {data.linked.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            판매·수금과 이은 입금 {data.linked.length}건 (이 달) — 잘못 이었으면 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.linked.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.at} · {r.payer} · +{won(r.amount)}원 → {r.n}건에 {won(r.used)}원
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      !(await ask({
                        title: "이 입금의 연결을 되돌릴까요?",
                        body: "이 입금으로 등록한 수금 기록도 함께 지워지고, 입금은 정리 목록으로 돌아옵니다.",
                        tone: "danger",
                        confirmLabel: "되돌리기",
                      }))
                    )
                      return;
                    act(
                      () => undoDepositLink(r.id),
                      (res: { removed: number; payments: number }) =>
                        `되돌렸습니다 — 연결 ${res.removed}건${res.payments > 0 ? ` · 수금 기록 ${res.payments}건` : ""} 지움. 입금이 정리 목록으로 돌아왔습니다.`,
                    );
                  }}
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
        잘못 이은 입금은 위 「판매·수금과 이은 입금」에서 되돌리면 수금 기록까지 함께 풀립니다.
      </p>
      <p className="mt-2 text-sm">
        다음 단계:{" "}
        <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          지출 분류 →
        </Link>
      </p>
      {confirmDialog}
    </>
  );
}
