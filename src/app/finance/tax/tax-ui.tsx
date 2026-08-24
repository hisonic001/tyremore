"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaxReconData, TaxSuggestion } from "@/lib/recon-data";
import { autoConfirmTax, confirmTaxMatch, ignoreTaxInvoice, linkCounterpartyToSupplier, undoTaxMatch } from "@/lib/recon";

const won = (n: number) => n.toLocaleString("ko-KR");
const bizFmt = (d: string) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);

export interface RecentRow {
  id: number;
  direction: string;
  d: string;
  name: string;
  total: number;
  refs: number;
}

/** ⭐ 세금계산서 ↔ 매입·판매 잇기 (ERP 2단계, 2026-08-24) */
export function TaxRecon({ data, recent }: { data: TaxReconData; recent: RecentRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 계산서마다 「이 상호 = 이 거래처」 직접 지정 (이름이 아예 다를 때) */
  const [supPick, setSupPick] = useState<Record<number, string>>({});

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

  const confirmBundle = (s: TaxSuggestion) =>
    s.bundle &&
    act(
      () =>
        confirmTaxMatch({
          taxInvoiceId: s.inv.id,
          refs: s.bundle!.map((b) => ({ table: b.table, id: b.id, amount: b.amount })),
          method: "수동",
          learnSupplierId: s.learnable ? s.supplierId : null,
        }),
      () => `${s.bundle!.length}건을 묶어서 이었습니다.`,
    );

  return (
    <>
      {/* 요약 + 자동확정 */}
      <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="tabular text-sm">
          확인할 것 <strong>{data.open.length}건</strong> · 확정 {data.doneCount}건 · 무시 {data.ignoredCount}건
        </p>
        {data.autoCount > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => autoConfirmTax(),
                (r: { confirmed: number }) => `${r.confirmed}건을 자동으로 이었습니다.`,
              )
            }
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            확실한 {data.autoCount}건 모두 잇기
          </button>
        )}
      </section>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}

      {data.open.length === 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          확인할 세금계산서가 없습니다 — 내역 올리기에서 홈택스 목록을 올리면 여기 나타납니다.
        </section>
      )}

      {/* 계산서별 카드 */}
      <ul className="mt-4 space-y-3">
        {data.open.map((s) => (
          <li key={s.inv.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">
                <span
                  className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-semibold ${
                    s.inv.direction === "매입" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {s.inv.direction}
                </span>
                <span className="font-medium">{s.inv.counterName}</span>
                <span className="tabular ml-1 text-xs text-slate-400">{bizFmt(s.inv.counterBizNo)}</span>
              </span>
              <span className="tabular shrink-0 font-bold">{won(s.inv.total)}원</span>
            </div>
            <p className="tabular mt-0.5 text-xs text-slate-500">
              {s.inv.writeDate}
              {s.inv.itemSummary && ` · ${s.inv.itemSummary}`}
            </p>

            {s.auto && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm">
                <p className="text-emerald-900">✔ 확실한 짝을 찾았습니다: {s.auto.label}</p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirmOne(s, s.auto!.table, s.auto!.id, "자동")}
                  className="mt-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  잇기
                </button>
              </div>
            )}

            {s.bundle && (
              <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">
                <p className="text-amber-900">
                  이 달 기록 {s.bundle.length}건의 합계가 정확히 맞습니다 (월합계 계산서로 보임)
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {s.bundle.map((b) => (
                    <li key={b.id}>· {b.label}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirmBundle(s)}
                  className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {s.bundle.length}건 묶어서 잇기
                </button>
              </div>
            )}

            {!s.auto && s.candidates.length > 0 && (
              <div className="mt-2 text-sm">
                <p className="text-xs text-slate-500">비슷한 기록 — 같은 건이면 눌러서 이으세요</p>
                <ul className="mt-1 space-y-1">
                  {s.candidates.map((c) => (
                    <li key={`${c.table}|${c.id}`} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs">{c.label}</span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => confirmOne(s, c.table, c.id, "수동")}
                        className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium"
                      >
                        잇기
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!s.auto && !s.bundle && s.candidates.length === 0 && (
              <p className="mt-2 text-xs text-slate-400">
                이을 만한 앱 기록을 못 찾았습니다 — 앱에 안 적힌 거래(광고비·수수료 등)면 무시를 누르세요
              </p>
            )}

            {/* ⭐ 앱 거래처 이름이 아예 달라 못 찾을 때 — 직접 지정하면 기억한다 (2026-08-25) */}
            {!s.auto && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <select
                  value={supPick[s.inv.id] ?? ""}
                  onChange={(e) => setSupPick((p) => ({ ...p, [s.inv.id]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">앱 거래처 이름이 다르면 고르기…</option>
                  {data.supplierOptions.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !supPick[s.inv.id]}
                  onClick={() =>
                    act(
                      () => linkCounterpartyToSupplier(s.inv.id, Number(supPick[s.inv.id])),
                      (r: { learned: string; warning: string | null }) =>
                        `「${s.inv.counterName}」 = ${r.learned} 거래처로 기억했습니다 — 후보를 다시 찾았습니다.${r.warning ? ` ⚠️ ${r.warning}` : ""}`,
                    )
                  }
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium disabled:opacity-40"
                >
                  이 거래처로 기억
                </button>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              {s.learnable && s.supplierName ? (
                <span className="text-xs text-slate-400">
                  이으면 「{s.supplierName}」 거래처에 이 사업자번호를 기억합니다
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => ignoreTaxInvoice(s.inv.id), () => "무시했습니다.")}
                className="text-xs text-slate-400 underline"
              >
                무시
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* 최근 확정 — 되돌리기 */}
      {recent.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-600">최근 확정 (잘못 이었으면 되돌리기)</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-xs">
                  <span className="tabular text-slate-400">{r.d}</span> {r.direction} · {r.name} ·{" "}
                  <span className="tabular">{won(r.total)}원</span>{" "}
                  <span className="text-slate-400">({r.refs}건 연결)</span>
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
        </section>
      )}
    </>
  );
}
