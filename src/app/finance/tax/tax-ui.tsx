"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PartyGroup, TaxReconV2, TaxSuggestion } from "@/lib/tax-recon";
import {
  autoConfirmTax,
  confirmTaxMatch,
  confirmTaxToBank,
  confirmTaxToBanks,
  ignoreTaxInvoice,
  linkCounterpartyToSupplier,
  markPastTax,
  markTaxExpense,
  markTaxFixPair,
  removeTaxPartyRule,
  revivePastTax,
  setTaxPartyRule,
  undoTaxMatch,
} from "@/lib/recon";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";
import { BankSearch, PickList } from "./link-parts";

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
  ym,
  pastInMonth,
  data,
  recent,
  cleared,
}: {
  ym: string;
  /** 이 달에 「과거분」으로 접어 둔 계산서 — 소급해 맞출 때 되살린다 */
  pastInMonth: { n: number; sum: number };
  data: TaxReconV2;
  recent: RecentRow[];
  cleared: ClearedRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치5 — 브라우저 confirm() 대체
  const [supPick, setSupPick] = useState<Record<string, string>>({});

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
      (r: { remaining: number; shortfall: number }) =>
        r.shortfall > 0
          ? `이었습니다 — 통장 금액이 계산서보다 ${won(r.shortfall)}원 적습니다 (수수료를 떼고 주고받은 것이면 그대로 두면 됩니다)`
          : r.remaining > 0
            ? `이었습니다 — 이 통장 줄에 ${won(r.remaining)}원이 남았습니다 (적립·다른 계산서 몫이면 이어서 잇기)`
            : "이었습니다 — 금액이 정확히 맞습니다.",
    );

  /* ⭐ 합이 딱 맞는 여러 출금·입금을 한꺼번에 (사장님 제보 2026-08-25 — 위즈오토) */
  const linkCombo = (s: TaxSuggestion) =>
    act(
      () => confirmTaxToBanks(s.inv.id, s.bankCombo!.ids),
      (r: { applied: number }) => `${r.applied}건을 합쳐 이었습니다 — 금액이 정확히 맞습니다.`,
    );

  const kindBadge = (g: PartyGroup) =>
    g.kind && (
      <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">
        {g.kind}
        <button
          type="button"
          disabled={pending}
          title="규칙 취소 — 이 상대의 자동 정리분(8월 이후)을 되살립니다"
          onClick={async () => {
            if (
              !(await ask({
                title: `${g.kind} 규칙을 취소할까요?`,
                body: `「${g.name}」 — 자동 정리됐던 계산서(8월 이후)가 다시 확인 목록으로 돌아옵니다.`,
                confirmLabel: "규칙 취소",
              }))
            )
              return;
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

  return (
    <>
      {/* ── 할 일 요약 + 사용법 ── */}
      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="tabular">
            {Number(ym.slice(5, 7))}월 할 일 <strong className="text-lg">{data.openCount}건</strong>
            <span className="text-sm text-slate-500"> ({data.groups.length}곳)</span>
          </p>
          {data.autoCount > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => autoConfirmTax(ym), (r: { confirmed: number }) => `${r.confirmed}건을 자동으로 이었습니다.`)}
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

      {/* ⭐ 이 달 과거분 되살리기 (사장님 요청 2026-08-25 — 지난달 소급 대사) */}
      {pastInMonth.n > 0 && (
        <section className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-sky-300 bg-sky-50 p-3">
          <p className="tabular text-sm text-sky-900">
            {Number(ym.slice(5, 7))}월 계산서 <strong>{pastInMonth.n}건 · {won(pastInMonth.sum)}원</strong>이
            「과거분」으로 접혀 있습니다 — 이 달을 맞춰 보시려면 되살리세요
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => revivePastTax(ym),
                (r: { revived: number }) => `${r.revived}건을 되살렸습니다 — 아래 목록에서 정리하세요.`,
              )
            }
            className="rounded-control bg-sky-700 px-3 py-2 text-sm font-semibold text-white active:bg-sky-800 disabled:opacity-40"
          >
            {Number(ym.slice(5, 7))}월 과거분 되살리기
          </button>
        </section>
      )}

      {/* 과거분 — 재업로드로 되살아난 것 */}
      {data.pastCount > 0 && ym >= "2026-08" && (
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
                  이 상대 기억하기 ▾ (경비 · 정산사 · 월정산 · 무시 · 거래처)
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
                  {/* ⭐ 월정산 (사장님 승인 2026-08-25) — 미쉐린처럼 월말 합계 계산서 + 수시 분할결제 */}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setTaxPartyRule({ bizNo: g.bizNo, nameRaw: g.name, kind: "월정산" }),
                        () => "월정산 거래처로 기억 — 「돈 확인」에서 잔액으로 봅니다.",
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium"
                    title="월말에 합계 계산서 한 장, 결제는 수시로 나눠 하는 거래처 (미쉐린·금호 등)"
                  >
                    월정산 (합계 계산서)
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

            {/* ⭐ 월정산 상대 — 개별 매칭 대신 잔액으로 (사장님 지적 2026-08-25) */}
            {g.kind === "월정산" && (
              <div className="mt-2 rounded-control bg-brand-50 p-2.5 text-xs">
                <p className="font-medium text-brand-700">
                  월정산 거래처입니다 — 계산서 한 장과 출금 한 건이 짝이 아니라서 하나씩 맞추지
                  않습니다.
                </p>
                <p className="mt-0.5 text-slate-600">
                  이 달 계산서 합과 지급 합, 그리고 <strong>아직 안 준 돈(잔액)</strong>만 보시면 됩니다.
                </p>
                <a
                  href={`/finance/tax?view=money&ym=${ym}&direction=매입`}
                  className="mt-1.5 inline-block rounded-control bg-brand-600 px-3 py-1.5 font-semibold text-white"
                >
                  돈 확인에서 잔액 보기 →
                </a>
              </div>
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
                      : s.bankCombo
                        ? "combo"
                        : s.candidates.length > 0
                          ? "cands"
                          : s.bankCands.length > 0
                            ? "bank"
                            : "none";
                const moreBits = [
                  primary !== "combo" && s.bankCombo ? `묶음 ${s.bankCombo.ids.length}` : null,
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
                    {primary === "combo" && s.bankCombo && (
                      <div className="mt-1.5 rounded bg-brand-50 p-1.5 text-xs">
                        <p className="font-medium text-brand-700">
                          ✔ 통장 {s.bankCombo.ids.length}건을 합치면 {won(s.bankCombo.total)}원 — 정확히 맞습니다
                        </p>
                        <ul className="mt-0.5 space-y-0.5 text-slate-600">
                          {s.bankCombo.labels.map((l, i) => (
                            <li key={i}>· {l}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => linkCombo(s)}
                          className="mt-1 rounded bg-brand-600 px-2.5 py-1 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                        >
                          {s.bankCombo.ids.length}건 한꺼번에 잇기
                        </button>
                      </div>
                    )}

                    {primary === "cands" && (
                      <div className="mt-1.5 rounded bg-white p-1.5 text-xs">
                        <PickList
                          hint="맞는 것을 고르세요:"
                          pending={pending}
                          items={s.candidates.map((c) => ({
                            key: `${c.table}|${c.id}`,
                            label: c.label,
                            onPick: () => confirmOne(s, c.table, c.id, "수동"),
                          }))}
                        />
                      </div>
                    )}
                    {primary === "bank" && (
                      <div className="mt-1.5 rounded bg-sky-50 p-1.5 text-xs">
                        <PickList
                          hint={`이 상대의 통장 ${s.inv.direction === "매입" ? "출금" : "입금"} — 맞는 것을 고르세요:`}
                          pending={pending}
                          strong
                          items={s.bankCands.map((b) => ({ key: b.id, label: b.label, onPick: () => bankLink(s, b.id) }))}
                        />
                      </div>
                    )}
                    {primary === "none" && g.kind !== "월정산" && (
                      <p className="mt-1.5 rounded bg-slate-50 p-1.5 text-xs text-slate-500">
                        딱 맞는 짝이 없습니다. 전기·통신·세금·수수료처럼 <strong>매달 나가는 비용</strong>이면
                        「다른 방법 ▾ → 경비로」가 맞습니다 — 전기요금은 계산서 금액과 실제 납부액이
                        (전력기금 때문에) 원래 다릅니다.
                      </p>
                    )}

                    {/* ② 다른 방법 — 전부 접어 둔다 (월정산 상대는 아예 감춘다) */}
                    <details className="mt-1.5" hidden={g.kind === "월정산"}>
                      <summary className="cursor-pointer text-xs text-slate-500 underline underline-offset-2">
                        다른 방법 ▾ ({moreBits.join(" · ")})
                      </summary>
                      <div className="mt-1.5 space-y-2 rounded bg-white p-2 text-xs">
                        {primary !== "combo" && s.bankCombo && (
                          <div>
                            <p className="font-medium text-brand-700">
                              통장 {s.bankCombo.ids.length}건 합계 {won(s.bankCombo.total)}원 — 정확히 맞음
                            </p>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => linkCombo(s)}
                              className="mt-1 rounded bg-brand-600 px-2.5 py-1 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                            >
                              {s.bankCombo.ids.length}건 한꺼번에 잇기
                            </button>
                          </div>
                        )}
                        {primary !== "cands" && s.candidates.length > 0 && (
                          <PickList
                            hint="앱 기록 후보"
                            pending={pending}
                            items={s.candidates.map((c) => ({
                              key: `${c.table}|${c.id}`,
                              label: c.label,
                              onPick: () => confirmOne(s, c.table, c.id, "수동"),
                            }))}
                          />
                        )}
                        {primary !== "bank" && s.bankCands.length > 0 && (
                          <PickList
                            hint={`같은 금액의 통장 ${s.inv.direction === "매입" ? "출금" : "입금"}`}
                            pending={pending}
                            items={s.bankCands.map((b) => ({ key: b.id, label: b.label, onPick: () => bankLink(s, b.id) }))}
                          />
                        )}
                        <div>
                          <p className="font-medium text-slate-600">통장에서 직접 찾기 (선입금·적립 등 금액이 달라도)</p>
                          <div className="mt-1">
                            <BankSearch direction={s.inv.direction} pending={pending} onPick={(id) => bankLink(s, id)} />
                          </div>
                        </div>
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
            {Number(ym.slice(5, 7))}월 정리된 계산서 {cleared.length}건 — 잘못 정리했으면 여기서 되살리기
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
      {confirmDialog}
    </>
  );
}
