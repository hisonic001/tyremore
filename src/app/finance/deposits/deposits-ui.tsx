"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { DepositReconData, DepositSuggestion } from "@/lib/recon-data";
import type { DepositBreakdown, DepositTaxBundles, DepositTaxCands, TransferSale } from "@/lib/deposit-tax";
import { clearPosNote, fixSaleMethod, setPosNote } from "@/lib/pos-actions";
import {
  collectFromDeposit,
  confirmSureDeposits,
  linkDepositToQuote,
  markCardSettlements,
  setDepositKind,
  undoDepositKind,
  undoDepositLink,
  unmarkCardSettlement,
} from "@/lib/fin-deposits";
import { confirmBankToTaxes, confirmTaxToBank } from "@/lib/recon";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";


/** ⭐ 통장 입금을 카드 정산·이체 판매·외상 수금으로 정리 (ERP 4단계, 2026-08-24) */
export function DepositsRecon({
  data,
  ym,
  taxCands,
  bundles,
  sureIds,
  breakdown,
  transfers,
}: {
  data: DepositReconData;
  ym: string;
  /** 입금 id → 열린 계산서 후보 (같은 상대·같은 금액) */
  taxCands: DepositTaxCands;
  /** 입금 id → 계산서 여러 장 합이 입금과 맞는 묶음 */
  bundles: DepositTaxBundles;
  /** 앱엔 계좌이체인데 법인 통장에 없는 판매 */
  transfers: TransferSale[];
  /** 짝이 확실한 입금 id — 한 번에 잇기 */
  sureIds: number[];
  breakdown: DepositBreakdown;
}) {
  const sureSet = new Set(sureIds);
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

      <section className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular">
          정리할 입금 <strong>{data.openTotal}건</strong>
          {data.openTotal > 0 && (
            <span className="text-xs text-slate-500">
              {" "}(계산서 짝 {breakdown.tax} · 판매 짝 {breakdown.quote} · 외상 {breakdown.party} · 확인 필요 {breakdown.none})
            </span>
          )}
          {data.openTotal > data.open.length && ` · 최근 ${data.open.length}건 표시`} · 정리됨 {data.doneCount}건 · 무시{" "}
          {data.ignoredCount}건
        </span>
        {/* ⭐ 짝이 확실한 것 한 번에 (사장님 요청 2026-08-26) */}
        {sureIds.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => confirmSureDeposits(ym),
                (r: { tax: number; quote: number; failed: number }) =>
                  `짝이 확실한 ${r.tax + r.quote}건을 이었습니다 (계산서 ${r.tax} · 판매 ${r.quote})${r.failed > 0 ? ` · ${r.failed}건은 실패` : ""}.`,
              )
            }
            className="shrink-0 rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            ✔ 짝이 확실한 {sureIds.length}건 모두 잇기
          </button>
        )}
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
          <li
            key={s.dep.id}
            className={`rounded-2xl border bg-white p-4 ${sureSet.has(s.dep.id) ? "border-brand-500" : "border-slate-200"}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="tabular text-xs text-slate-400">{s.dep.at}</span>{" "}
                <span className="font-medium">{s.dep.description}</span>
                {sureSet.has(s.dep.id) && (
                  <span className="ml-1.5 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">짝 확실</span>
                )}
              </span>
              <span className="tabular shrink-0 font-bold text-emerald-700">+{won(s.dep.amount)}원</span>
            </div>

            {/* ⭐ 입금 한 줄 = 계산서 여러 장 (레드캡 624,800 = 528,000 + 96,800) */}
            {bundles[s.dep.id] && (
              <div className="mt-2 rounded-lg bg-brand-50 p-2 text-sm">
                <p className="text-xs font-semibold text-brand-700">
                  ✔ 이 입금은 계산서 {bundles[s.dep.id].invoiceIds.length}장 합({bundles[s.dep.id].parts.join(" + ")})과{" "}
                  {bundles[s.dep.id].diff === 0
                    ? "정확히 맞습니다"
                    : `${won(Math.abs(bundles[s.dep.id].diff))}원 차이(수수료·반올림 — 자동 정리)`}
                </p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => confirmBankToTaxes(s.dep.id, bundles[s.dep.id].invoiceIds),
                      (r: { applied: number }) => `계산서 ${r.applied}장을 이 입금 하나에 이었습니다.`,
                    )
                  }
                  className="mt-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                >
                  이 입금으로 {bundles[s.dep.id].invoiceIds.length}장 한꺼번에 잇기
                </button>
              </div>
            )}
            {/* ⭐ 세금계산서 바로 잇기 (사장님 요청 2026-08-26) — 전엔 "계산서 화면에서 이으세요"만 있고 버튼이 없었다 */}
            {(taxCands[s.dep.id]?.length ?? 0) > 0 && (
              <div className="mt-2 rounded-lg bg-violet-50 p-2 text-sm">
                <p className="text-xs text-violet-900">
                  세금계산서 대금으로 보입니다 — 맞는 계산서와 이으세요
                  {taxCands[s.dep.id].some((c) => c.direction === "매입") && " (↔ = 수수료를 떼고 받은 정산, 매입 계산서와 상쇄)"}
                </p>
                <ul className="mt-1 space-y-1">
                  {taxCands[s.dep.id].map((c) => (
                    <li key={c.invId} className="flex items-center justify-between gap-2">
                      <span className="tabular min-w-0 truncate text-xs">{c.label}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          act(
                            () => confirmTaxToBank(c.invId, s.dep.id),
                            (r: { remaining: number; shortfall: number }) =>
                              r.shortfall > 0
                                ? `이었습니다 — 계산서에 ${won(r.shortfall)}원이 남았습니다 (다른 입금을 이어서 잇거나 계산서 화면에서 「확인 끝」)`
                                : r.remaining > 0
                                  ? `이었습니다 — 이 입금에 ${won(r.remaining)}원이 남았습니다 (다른 계산서 몫이면 이어서)`
                                  : "이었습니다 — 금액이 정확히 맞습니다.",
                          )
                        }
                        className={`shrink-0 rounded-control px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                          c.exact && c.known ? "bg-brand-600 text-white active:bg-brand-700" : "border border-slate-300 bg-white"
                        }`}
                      >
                        이 계산서와 잇기
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.taxHint && !(taxCands[s.dep.id]?.length > 0) && (
              <p className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-800">
                ★ {s.taxHint} — 열린 계산서가 이 달 근처에 없습니다. 계산서가 아직 안 올라왔으면 나중에, 아니면 아래에서 분류하세요
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
                <p className="text-xs text-slate-500">
                  같은 금액의 판매 — 같은 건이면 이으세요 (앱에 카드·현금으로 적혀 있어도 실제 이체였으면 잇기)
                </p>
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

            {s.parties.length === 0 && s.quotes.length === 0 && !(taxCands[s.dep.id]?.length > 0) && (
              <p className="mt-2 text-xs text-slate-400">
                판매·계산서·외상 짝을 못 찾았습니다 — 계산서가 나중에 올라오면 다시 나타나고, 판매와 무관한 돈이면 아래에서 골라 주세요
              </p>
            )}

            {/* 「무시」 대신 무엇인지 고르기 (사장님 요청 2026-08-26) — 앱에 기록 없는 판매 대금이 가장 흔하다 */}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 text-xs">
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => setDepositKind(s.dep.id, "판매입금"), () => "「판매 대금(앱 기록 없음)」으로 정리 — 손익의 번 돈에 들어갑니다.")}
                title="앱에 판매 기록이 없는 대금 — 손익에 매출로 잡히고, 나중에 정비내역을 등록하면 되돌려 이으면 됩니다"
                className="rounded-full border border-brand-500 bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700 active:bg-brand-100 disabled:opacity-40"
              >
                판매 대금 (앱 기록 없음)
              </button>
              <span className="text-slate-400">· 판매와 무관하면:</span>
              {(["이자·지원금", "환불", "기타입금"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => setDepositKind(s.dep.id, k), () => `「${k}」으로 정리했습니다.`)}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 active:bg-slate-100 disabled:opacity-40"
                >
                  {k}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* ⭐ 계좌이체로 적혔는데 법인 통장에 없는 판매 (사장님 제보 2026-08-26 — 개인 통장으로 보내는 손님) */}
      {transfers.length > 0 && (
        <section className="mt-4 rounded-2xl border border-amber-300 bg-white p-4">
          <h2 className="text-sm font-semibold">
            앱엔 「계좌이체」인데 법인 통장에 안 보이는 판매 {transfers.filter((t) => !t.note).length}건
            {transfers.some((t) => t.note) && <span className="font-normal text-slate-400"> · 정리됨 {transfers.filter((t) => t.note).length}건</span>}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            개인 통장으로 받았거나 현금으로 받은 걸 이체로 적은 경우가 대부분입니다 — 무엇이었는지 한 번만 골라 주세요.
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {transfers.map((t) => (
              <li key={t.key} className={`rounded-lg border p-2 ${t.note ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular min-w-0 truncate text-xs">
                    <span className="text-slate-400">{t.day.slice(5)}</span> {t.quoteNo} · {t.who}
                  </span>
                  <strong className="tabular shrink-0">{won(t.amount)}원</strong>
                </div>
                {t.note ? (
                  <p className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{t.note.reason}{t.note.memo ? ` — ${t.note.memo}` : ""}</span>
                    <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(t.key), () => "되돌렸습니다.")} className="underline">되돌리기</button>
                  </p>
                ) : (
                  <div className="mt-1 space-y-1 text-xs">
                    {t.cands.map((c) => (
                      <div key={c.cashId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">통장에 같은 금액: {c.label}</span>
                        <button type="button" disabled={pending} onClick={() => act(() => linkDepositToQuote(c.cashId, t.quoteId), () => "이었습니다.")}
                          className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1 font-semibold text-white active:bg-brand-700 disabled:opacity-40">이 입금과 잇기</button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button type="button" disabled={pending}
                        onClick={() => act(() => setPosNote({ day: t.day, kind: "transfer", ref: t.key, reason: "개인통장 입금" }), () => "「개인 통장으로 받음」으로 정리했습니다.")}
                        className="rounded-full border border-brand-500 bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700 disabled:opacity-40">개인 통장으로 받음</button>
                      <button type="button" disabled={pending}
                        onClick={() => act(() => fixSaleMethod(t.quoteId, "현금"), () => "결제수단을 현금으로 고쳤습니다.")}
                        className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 disabled:opacity-40">현금으로 받음 (수단 고치기)</button>
                      <button type="button" disabled={pending}
                        onClick={() => act(() => setPosNote({ day: t.day, kind: "transfer", ref: t.key, reason: "아직 안 들어옴" }), () => "「아직 안 들어옴」으로 남겼습니다 — 들어오면 되돌리고 이으세요.")}
                        className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 disabled:opacity-40">아직 안 들어옴</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 판매와 무관으로 분류한 입금 — 되돌리기 */}
      {data.kinds.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            분류로 정리한 입금 {data.kinds.length}건 (이 달 · 판매 대금/이자/환불/기타) — 잘못 골랐으면 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.kinds.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.at} · {r.payer} · +{won(r.amount)}원 · {r.category}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => undoDepositKind(r.id), () => "되돌렸습니다 — 정리 목록으로 돌아갔습니다.")}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

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
