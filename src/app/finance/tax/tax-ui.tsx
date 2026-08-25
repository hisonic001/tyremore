"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PartyGroup, TaxReconV2, TaxSuggestion } from "@/lib/tax-recon";
import {
  autoConfirmTax,
  confirmTaxMatch,
  confirmTaxToBank,
  ignoreTaxInvoice,
  linkCounterpartyToSupplier,
  searchBankLines,
  markPastTax,
  markTaxExpense,
  markTaxFixPair,
  removeTaxPartyRule,
  setTaxPartyRule,
  undoTaxMatch,
} from "@/lib/recon";
import { won } from "@/components/fin/money";

const bizFmt = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

export interface RecentRow {
  id: number;
  direction: string;
  d: string;
  name: string;
  total: number;
  refs: number;
  reason: string | null;
}

export interface ClearedRow {
  id: number;
  direction: string;
  d: string;
  name: string;
  total: number;
  reason: string | null;
}

/**
 * ⭐ 세금계산서 대조 v2 — 가독성 개편 (사장님 지시 2026-08-24: "뭐가 뭔지 한눈에 안 들어옴")
 *
 *   원칙: **계산서 하나 = 추천 하나.** 가장 확실한 길 하나만 밖에 보여주고
 *   (자동 > 수정상쇄 > 묶음 > 앱 후보 > 통장 후보), 나머지 길은 전부
 *   「다른 방법 ▾」 안으로. 상대 유형 정하기도 접어 둔다. 로직·액션은 그대로.
 */
export function TaxRecon({
  data,
  recent,
  cleared,
}: {
  data: TaxReconV2;
  recent: RecentRow[];
  cleared: ClearedRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supPick, setSupPick] = useState<Record<string, string>>({});
  /** 계산서별 통장 직접 검색어 (선입금·적립 등 금액이 다른 경우) */
  const [bankQ, setBankQ] = useState<Record<number, string>>({});
  const [bankHits, setBankHits] = useState<Record<number, { id: number; label: string }[]>>({});

  const act = (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: (r: never) => string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(String((r as { error?: string }).error ?? "실패했습니다"));
      setMsg(okMsg(r as never));
      router.refresh();
    });

  const confirmOne = (s: TaxSuggestion, table: "purchase_invoice" | "quote", id: number, method: "자동" | "수동") =>
    act(
      () =>
        confirmTaxMatch({
          taxInvoiceId: s.inv.id,
          refs: [{ table, id, amount: s.inv.total }],
          method,
          learnSupplierId: s.learnable ? s.supplierId : null,
        }),
      (r: { warning: string | null }) => `이었습니다.${r.warning ? ` ⚠️ ${r.warning}` : ""}`,
    );

  /** 통장 잇기 공통 — 남은 금액·차액을 그대로 알려준다 */
  const bankLink = (s: TaxSuggestion, cashId: number) =>
    act(
      () => confirmTaxToBank(s.inv.id, cashId),
      (r: { remaining: number }) =>
        r.remaining > 0
          ? `이었습니다 — 이 통장 줄에 ${won(r.remaining)}원이 남았습니다 (적립·다른 계산서 몫이면 이어서 잇기)`
          : r.remaining < 0
            ? `이었습니다 — 계산서가 통장 금액보다 ${won(-r.remaining)}원 큽니다 (수수료 차감 등이면 정상)`
            : "이었습니다 — 금액이 정확히 맞습니다.",
    );

  const kindBadge = (g: PartyGroup) =>
    g.kind && (
      <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
        {g.kind}
        <button
          type="button"
          disabled={pending}
          title="규칙 취소 — 이 상대의 자동 정리분(8월 이후)을 되살립니다"
          onClick={() => {
            if (!confirm(`「${g.name}」의 ${g.kind} 규칙을 취소할까요?
자동 정리됐던 계산서(8월 이후)가 다시 확인 목록으로 돌아옵니다.`)) return;
            act(
              () => removeTaxPartyRule(g.bizNo),
              (r: { revived: number }) => `규칙을 취소했습니다 — ${r.revived}건이 돌아왔습니다.`,
            );
          }}
          className="ml-1 text-violet-500 hover:text-red-600"
        >
          ✕
        </button>
      </span>
    );

  /** 통장 직접 검색 — 「다른 방법」 안에서 쓰는 공통 조각 */
  const bankSearch = (s: TaxSuggestion) => (
    <div>
      <p className="font-medium text-slate-600">통장에서 직접 찾기 (선입금·적립 등 금액이 달라도)</p>
      <div className="mt-1 flex gap-1.5">
        <input
          value={bankQ[s.inv.id] ?? ""}
          onChange={(e) => setBankQ((p) => ({ ...p, [s.inv.id]: e.target.value }))}
          placeholder="입금자·내용·금액으로 검색"
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5"
        />
        <button
          type="button"
          disabled={pending || !(bankQ[s.inv.id] ?? "").trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await searchBankLines(s.inv.direction, bankQ[s.inv.id] ?? "");
              if (!r.ok) return setError(r.error);
              setBankHits((p) => ({ ...p, [s.inv.id]: r.rows }));
            })
          }
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium disabled:opacity-40"
        >
          검색
        </button>
      </div>
      <ul className="mt-1 space-y-1">
        {(bankHits[s.inv.id] ?? []).map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{b.label}</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => bankLink(s, b.id)}
              className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium"
            >
              잇기
            </button>
          </li>
        ))}
        {bankHits[s.inv.id] !== undefined && (bankHits[s.inv.id] ?? []).length === 0 && (
          <li className="text-slate-400">맞는 통장 줄이 없습니다 (전체 기간 검색)</li>
        )}
      </ul>
    </div>
  );

  return (
    <>
      {/* ── 할 일 요약 + 사용법 ── */}
      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular">
            할 일 <strong className="text-lg">{data.openCount}건</strong>
            <span className="text-sm text-slate-500"> ({data.groups.length}곳)</span>
          </p>
          {data.autoCount > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => autoConfirmTax(), (r: { confirmed: number }) => `${r.confirmed}건을 자동으로 이었습니다.`)}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              ✔ 확실한 {data.autoCount}건 모두 잇기
            </button>
          )}
        </div>
        <ol className="mt-2 list-inside list-decimal space-y-0.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          <li>
            <strong className="text-emerald-800">초록 「잇기」</strong>부터 누르세요 — 확실한 것만 초록입니다
          </li>
          <li>
            추천이 안 맞거나 없으면 <strong>「다른 방법 ▾」</strong>을 펼치세요 (후보 고르기 · 통장 검색 · 경비 · 무시)
          </li>
          <li>
            늘 같은 상대(경비·정산사·거래처)는 <strong>「이 상대 기억하기 ▾」</strong>로 한 번만 정하면 계속 자동입니다
          </li>
        </ol>
        <p className="tabular mt-1.5 text-xs text-slate-400">
          지금까지: 확정 {data.doneCount}건 · 정리됨 {data.ignoredCount}건
          {data.reasonCounts.length > 0 && <> ({data.reasonCounts.map((r) => `${r.reason} ${r.n}`).join(" · ")})</>}
        </p>
      </section>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}

      {/* 과거분 — 재업로드로 되살아난 것 */}
      {data.pastCount > 0 && (
        <section className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-300 bg-slate-50 p-3">
          <p className="tabular text-sm text-slate-600">
            앱 도입(8월) 이전 과거분 {data.pastCount}건 · {won(data.pastSum)}원 — 대조할 앱 기록이 없던 시절입니다
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => markPastTax(), (r: { applied: number }) => `과거분 ${r.applied}건을 정리했습니다.`)}
            className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium"
          >
            과거분 일괄 정리
          </button>
        </section>
      )}

      {data.openCount === 0 && data.pastCount === 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          확인할 세금계산서가 없습니다 🎉
        </section>
      )}

      {/* ── 상대별 그룹 ── */}
      <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {data.groups.map((g: PartyGroup) => (
          <li key={g.bizNo} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <Link
                  href={`/finance/party/${encodeURIComponent(
                    g.items[0]?.supplierName ? `S:${g.items[0].supplierName}` : `B:${g.bizNo}`,
                  )}`}
                  className="font-semibold underline-offset-2 hover:underline"
                  title="이 상대의 원장 보기"
                >
                  {g.name}
                </Link>
                {kindBadge(g)}
                <span className="tabular ml-1 text-xs text-slate-400">{bizFmt(g.bizNo)}</span>
              </span>
              <span className="tabular shrink-0 text-sm">
                {g.count}건 · <strong>{won(g.sum)}원</strong>
              </span>
            </div>

            {/* 상대 유형 — 접어 두고, 한 번 정하면 계속 자동 */}
            {!g.kind && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-xs font-medium text-violet-700 underline underline-offset-2">
                  이 상대 기억하기 ▾ (경비 · 정산사 · 무시 · 거래처)
                </summary>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-violet-50 p-2 text-xs">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setTaxPartyRule({ bizNo: g.bizNo, nameRaw: g.name, kind: "경비" }),
                        (r: { applied: number }) => `경비로 기억 — ${r.applied}건 정리, 앞으로 자동입니다.`,
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium"
                  >
                    경비 (계속 자동 정리)
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setTaxPartyRule({ bizNo: g.bizNo, nameRaw: g.name, kind: "대행정산" }),
                        () => "대행 정산사로 기억 — 통장 입금과 이으세요.",
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium"
                  >
                    보험·렌터카 정산사
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setTaxPartyRule({ bizNo: g.bizNo, nameRaw: g.name, kind: "무시" }),
                        (r: { applied: number }) => `무시로 기억 — ${r.applied}건 정리했습니다.`,
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-500"
                  >
                    무시 (계속)
                  </button>
                  {/* 거래처가 많아 목록 대신 검색 자동완성 (사장님 요청 2026-08-25) */}
                  <input
                    value={supPick[g.bizNo] ?? ""}
                    onChange={(e) => setSupPick((p) => ({ ...p, [g.bizNo]: e.target.value }))}
                    list="tax-sup-options"
                    placeholder="거래처면 검색…"
                    className="w-32 rounded-lg border border-slate-300 px-2 py-1.5"
                  />
                  <button
                    type="button"
                    disabled={pending || !data.supplierOptions.some((sp) => sp.name === (supPick[g.bizNo] ?? "").trim())}
                    onClick={() => {
                      const sp = data.supplierOptions.find((o) => o.name === (supPick[g.bizNo] ?? "").trim());
                      if (!sp) return;
                      act(
                        () => linkCounterpartyToSupplier(g.items[0].inv.id, sp.id),
                        (r: { learned: string }) => `${r.learned} 거래처로 기억했습니다 — 후보를 다시 찾았습니다.`,
                      );
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium disabled:opacity-40"
                  >
                    거래처로 기억
                  </button>
                </div>
              </details>
            )}

            {/* 계산서별 — 추천 하나만 크게, 나머지는 「다른 방법 ▾」 */}
            <ul className="mt-2 space-y-2">
              {g.items.map((s) => {
                // 🔴 가독성의 핵심: 가장 확실한 길 하나만 밖에 보여준다
                const primary = s.auto
                  ? "auto"
                  : s.fixPair
                    ? "fix"
                    : s.bundle
                      ? "bundle"
                      : s.candidates.length > 0
                        ? "cands"
                        : s.bankCands.length > 0
                          ? "bank"
                          : "none";
                const moreBits = [
                  primary !== "cands" && s.candidates.length > 0 ? `앱 기록 ${s.candidates.length}` : null,
                  primary !== "bank" && s.bankCands.length > 0 ? `통장 ${s.bankCands.length}` : null,
                  "통장 검색",
                  s.inv.direction === "매입" ? "경비" : null,
                  "무시",
                ].filter(Boolean);
                return (
                  <li key={s.inv.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="tabular min-w-0 truncate text-sm">
                        <span
                          className={`mr-1 rounded px-1 py-0.5 text-xs font-semibold ${
                            s.inv.direction === "매입" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {s.inv.direction}
                        </span>
                        {s.inv.writeDate.slice(5)}
                        {s.inv.itemSummary && <span className="text-slate-500"> · {s.inv.itemSummary}</span>}
                      </span>
                      <span className="tabular shrink-0 font-bold">{won(s.inv.total)}원</span>
                    </div>

                    {/* ① 추천 — 하나만 */}
                    {primary === "auto" && s.auto && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-emerald-50 p-1.5 text-xs">
                        <span className="min-w-0 truncate text-emerald-900">✔ {s.auto.label}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => confirmOne(s, s.auto!.table, s.auto!.id, "자동")}
                          className="shrink-0 rounded bg-emerald-700 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                        >
                          잇기
                        </button>
                      </div>
                    )}
                    {primary === "fix" && s.fixPair && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-rose-50 p-1.5 text-xs">
                        <span className="min-w-0 truncate text-rose-900">
                          마이너스(수정) 계산서 — 원본: {s.fixPair.label}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            act(() => markTaxFixPair(s.inv.id, s.fixPair!.id), () => "원본과 상쇄해 정리했습니다.")
                          }
                          className="shrink-0 rounded bg-rose-600 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                        >
                          원본과 정리
                        </button>
                      </div>
                    )}
                    {primary === "bundle" && s.bundle && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded bg-emerald-50 p-1.5 text-xs">
                        <span className="text-emerald-900">✔ 이 달 {s.bundle.length}건 합계가 정확히 맞습니다</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            act(
                              () =>
                                confirmTaxMatch({
                                  taxInvoiceId: s.inv.id,
                                  refs: s.bundle!.map((b) => ({ table: b.table, id: b.id, amount: b.amount })),
                                  method: "수동",
                                  learnSupplierId: s.learnable ? s.supplierId : null,
                                }),
                              () => `${s.bundle!.length}건을 묶어서 이었습니다.`,
                            )
                          }
                          className="shrink-0 rounded bg-emerald-700 px-2.5 py-1 font-semibold text-white disabled:opacity-40"
                        >
                          묶어서 잇기
                        </button>
                      </div>
                    )}
                    {primary === "cands" && (
                      <ul className="mt-1.5 space-y-1 rounded bg-white p-1.5 text-xs">
                        <li className="text-slate-500">맞는 것을 고르세요:</li>
                        {s.candidates.map((c) => (
                          <li key={`${c.table}|${c.id}`} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">{c.label}</span>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => confirmOne(s, c.table, c.id, "수동")}
                              className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium"
                            >
                              잇기
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {primary === "bank" && (
                      <ul className="mt-1.5 space-y-1 rounded bg-sky-50 p-1.5 text-xs">
                        <li className="text-sky-900">
                          같은 금액의 통장 {s.inv.direction === "매입" ? "출금" : "입금"}이 있습니다:
                        </li>
                        {s.bankCands.map((b) => (
                          <li key={b.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">{b.label}</span>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => bankLink(s, b.id)}
                              className="shrink-0 rounded bg-sky-700 px-2 py-0.5 font-semibold text-white disabled:opacity-40"
                            >
                              잇기
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {primary === "none" && (
                      <p className="mt-1.5 text-xs text-slate-400">
                        추천 없음 — 「다른 방법 ▾」에서 통장을 검색하거나, 위 「이 상대 기억하기」로 유형을 정하세요
                      </p>
                    )}

                    {/* ② 다른 방법 — 전부 접어 둔다 */}
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs text-slate-500 underline underline-offset-2">
                        다른 방법 ▾ ({moreBits.join(" · ")})
                      </summary>
                      <div className="mt-1.5 space-y-2 rounded bg-white p-2 text-xs">
                        {primary !== "cands" && s.candidates.length > 0 && (
                          <div>
                            <p className="font-medium text-slate-600">앱 기록 후보</p>
                            <ul className="mt-0.5 space-y-1">
                              {s.candidates.map((c) => (
                                <li key={`${c.table}|${c.id}`} className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{c.label}</span>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => confirmOne(s, c.table, c.id, "수동")}
                                    className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium"
                                  >
                                    잇기
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {primary !== "bank" && s.bankCands.length > 0 && (
                          <div>
                            <p className="font-medium text-slate-600">
                              같은 금액의 통장 {s.inv.direction === "매입" ? "출금" : "입금"}
                            </p>
                            <ul className="mt-0.5 space-y-1">
                              {s.bankCands.map((b) => (
                                <li key={b.id} className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{b.label}</span>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => bankLink(s, b.id)}
                                    className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium"
                                  >
                                    잇기
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {bankSearch(s)}
                        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-1.5">
                          {s.inv.direction === "매입" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                act(
                                  () => markTaxExpense(s.inv.id),
                                  (r: { applied: number; item: string | null }) =>
                                    r.item
                                      ? `「${r.item}」 품목은 경비로 기억 — ${r.applied}건 정리, 앞으로 자동입니다.`
                                      : "경비로 정리했습니다.",
                                )
                              }
                              className="text-slate-500 underline"
                              title="미쉐린 digital module 처럼 매입과 수수료가 섞인 상대는 품목 단위로 배웁니다"
                            >
                              경비로 (이 품목 계속 자동)
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => act(() => ignoreTaxInvoice(s.inv.id), () => "무시했습니다.")}
                            className="text-slate-400 underline"
                          >
                            이 건만 무시
                          </button>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <datalist id="tax-sup-options">
        {data.supplierOptions.map((sp) => (
          <option key={sp.id} value={sp.name} />
        ))}
      </datalist>

      {/* 정리(무시)된 것 — 잘못 정리했으면 되살리기 */}
      {cleared.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            정리된 계산서 {cleared.length}건 (8월 이후) — 잘못 정리했으면 여기서 되살리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {cleared.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-xs">
                  <span className="tabular text-slate-400">{r.d}</span> {r.direction} · {r.name} ·{" "}
                  <span className="tabular">{won(r.total)}원</span>
                  {r.reason && <span className="text-slate-400"> · {r.reason}</span>}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => ignoreTaxInvoice(r.id, true), () => "되살렸습니다 — 확인 목록으로 돌아갔습니다.")}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  되살리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 최근 확정 — 되돌리기 (접어 둔다) */}
      {recent.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            최근 확정 {recent.length}건 — 잘못 이었으면 여기서 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-xs">
                  <span className="tabular text-slate-400">{r.d}</span> {r.direction} · {r.name} ·{" "}
                  <span className="tabular">{won(r.total)}원</span>{" "}
                  <span className="text-slate-400">
                    ({r.refs}건 연결{r.reason ? ` · ${r.reason}` : ""})
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => undoTaxMatch(r.id), () => "되돌렸습니다.")}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
