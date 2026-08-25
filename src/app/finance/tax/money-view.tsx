"use client";

/**
 * ⭐ 돈 확인 뷰 (tax 재설계 배치2, 사장님 요구 2026-08-25)
 *
 *   "매입·매출 계산서에 대응해 실제로 출금·입금 됐는지" — 의 단일 답변처.
 *   진행률(bank_ok 기준) + 돈 미확인 계산서 목록(금액 큰 순) + 통장 잇기.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { TaxCashData } from "@/lib/tax-recon";
import { closeTaxShortfall, confirmTaxToBank, undoTaxMatch } from "@/lib/recon";
import { useConfirm } from "@/components/ui/confirm";
import { won } from "@/components/fin/money";
import { BankSearch, PickList } from "./link-parts";

export interface RecentBankRow {
  id: number;
  d: string;
  direction: string;
  name: string;
  total: number;
}

export function MoneyView({ data, recentBank }: { data: TaxCashData; recentBank: RecentBankRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const isIn = data.direction === "매출";

  const link = (invId: number, cashId: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmTaxToBank(invId, cashId);
      if (!r.ok) return setError(r.error);
      setMsg(
        r.shortfall > 0
          ? `일부 확인 — 계산서에 ${won(r.shortfall)}원이 남았습니다. 다른 ${isIn ? "입금" : "출금"}을 이어서 잇거나, 수수료·적립 차액이면 「확인 끝」을 누르세요`
          : r.remaining > 0
            ? `확인했습니다 — 이 통장 줄에 ${won(r.remaining)}원이 남았습니다 (다른 계산서 몫이면 이어서 확인하세요)`
            : "확인했습니다 — 금액이 정확히 맞습니다.",
      );
      router.refresh();
    });

  const settle = async (invId: number, remain: number) => {
    if (
      !(await ask({
        title: "남은 차액을 확인 끝으로 정리할까요?",
        body: `남은 ${won(remain)}원을 수수료·적립·에누리 차액으로 보고 이 계산서의 돈 확인을 끝냅니다.\n(잘못 정리했으면 「통장 연결 되돌리기」로 함께 풀립니다)`,
        confirmLabel: "확인 끝",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await closeTaxShortfall(invId);
      if (!r.ok) return setError(r.error);
      setMsg(`차액 ${won(r.settled)}원을 정리하고 확인을 끝냈습니다.`);
      router.refresh();
    });
  };

  const undoBank = (invId: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await undoTaxMatch(invId, "통장");
      if (!r.ok) return setError(r.error);
      setMsg("통장 연결을 되돌렸습니다 — 목록으로 돌아갑니다.");
      router.refresh();
    });

  const pct = data.total.n > 0 ? Math.round((data.bankOk.n / data.total.n) * 100) : 0;
  const base = `/finance/tax?view=money&ym=${data.ym}`;
  const seg = (on: boolean) =>
    `flex-1 rounded-full py-2.5 text-center text-sm font-semibold transition-colors ${
      on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
    }`;

  return (
    <>
      {/* 매입/매출 토글 — 방향을 섞지 않는다 (직관성) */}
      <div className="mt-3 flex gap-1 rounded-full bg-slate-100 p-1">
        <Link href={`${base}&direction=매입`} className={seg(!isIn)}>
          매입 — 돈이 나갔나 (출금)
        </Link>
        <Link href={`${base}&direction=매출`} className={seg(isIn)}>
          매출 — 돈이 들어왔나 (입금)
        </Link>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-700">✓ {msg}</p>}

      {/* 진행률 — 사장님 질문의 답 */}
      <section className="mt-3 rounded-card border-2 border-brand-500 bg-white p-4">
        <p className="tabular text-sm">
          {Number(data.ym.slice(5, 7))}월 {data.direction} 계산서{" "}
          <strong className="text-lg">
            {data.total.n}건 중 {data.bankOk.n}건
          </strong>{" "}
          {isIn ? "입금" : "출금"} 확인됨
        </p>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="tabular mt-1.5 text-xs text-slate-500">
          {won(data.bankOk.sum)}원 확인 / 전체 {won(data.total.sum)}원
          {data.ignoredN > 0 && ` · 정리(무시) ${data.ignoredN}건은 셈에서 뺐습니다`}
        </p>
      </section>

      {/* 돈 미확인 목록 — 금액 큰 순 */}
      {data.rows.length === 0 ? (
        <section className="mt-4 rounded-card border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          이 달 {data.direction} 계산서는 전부 돈이 확인됐습니다 🎉
        </section>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
          {data.rows.map((r) => (
            <li key={r.id} className="rounded-card border border-slate-200 bg-white p-3 shadow-card">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular min-w-0 truncate text-sm">
                  <span className="text-xs text-slate-400">{r.d}</span>{" "}
                  <span className="font-medium">{r.name}</span>
                </span>
                <span className="tabular shrink-0 font-bold">{won(r.total)}원</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {r.bankCovered > 0 ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                    일부 확인 · 남은 {won(r.total - r.bankCovered)}원
                  </span>
                ) : r.appLinked ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    앱 기록 있음 · 돈 미확인
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                    미확인
                  </span>
                )}
                {r.bankCovered > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => settle(r.id, r.total - r.bankCovered)}
                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600 active:bg-slate-100 disabled:opacity-40"
                  >
                    남은 건 수수료·적립 — 확인 끝
                  </button>
                )}
              </div>
              {r.autoBank.length > 0 && (
                <PickList
                  hint={`같은 금액·기억된 ${isIn ? "입금" : "출금"}:`}
                  pending={pending}
                  strong
                  items={r.autoBank.map((b) => ({
                    key: b.id,
                    label: b.label,
                    onPick: () => link(r.id, b.id),
                  }))}
                  buttonLabel={isIn ? "이 입금과 잇기" : "이 출금과 잇기"}
                />
              )}
              {r.autoBank.length > 0 ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-slate-500 underline underline-offset-2">
                    통장에서 직접 찾기 ▾
                  </summary>
                  <div className="mt-1">
                    <BankSearch direction={data.direction} pending={pending} onPick={(id) => link(r.id, id)} />
                  </div>
                </details>
              ) : (
                <div className="mt-1.5">
                  <BankSearch direction={data.direction} pending={pending} onPick={(id) => link(r.id, id)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.moreN > 0 && (
        <p className="tabular mt-2 text-xs text-slate-400">
          금액 작은 것 {data.moreN}건이 더 있습니다 — 위 건들을 확인하면 이어서 나옵니다
        </p>
      )}

      {/* 최근 통장 연결 — 잘못 이었으면 통장 연결만 되돌리기 */}
      {recentBank.length > 0 && (
        <details className="mt-4 rounded-card border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            최근 돈 확인 {recentBank.length}건 — 잘못 이었으면 여기서 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {recentBank.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.d} {r.direction} · {r.name} · {won(r.total)}원
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => undoBank(r.id)}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  통장 연결 되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-xs text-slate-400">
        카드·현금으로 받은 판매 대금은 통장에 계산서 단위로 찍히지 않아 여기서 확인되지 않습니다 —
        카드는 「카드 대사」에서 따로 맞춥니다. 상대 유형 정리·앱 기록 잇기는 「계산서 정리」 뷰에서.
      </p>
      {confirmDialog}
    </>
  );
}
