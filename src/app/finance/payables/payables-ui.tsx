"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PayLinkRow, PayLinkedRow, PayablesData, PayableSupplier } from "@/lib/recon-data";
import { payFromWithdrawal, payToSupplier, removePurchasePayment, undoPayFromWithdrawal } from "@/lib/purchase-pay";
import { won } from "@/components/fin/money";
import { useConfirm } from "@/components/ui/confirm";

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const METHODS = ["계좌이체", "현금", "카드", "기타"];

/** ⭐ 미지급 장부 — 거래처별 잔액 + 지급 등록 (ERP ⑦, 2026-08-25) */
export function PayablesUi({
  data,
  links,
  linked,
  supplierNames,
  cashSummary,
}: {
  data: PayablesData;
  links: PayLinkRow[];
  /** 이 달 「지급 잡기」로 이은 출금 — 되돌리기 목록 */
  linked: PayLinkedRow[];
  supplierNames: string[];
  cashSummary: { ym: string; n: number; sum: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치5 — 브라우저 confirm() 대체
  /** 거래처별 지급 폼 상태 */
  const [form, setForm] = useState<Record<string, { amount: string; method: string; paidOn: string }>>({});

  /** 출금 → 거래처 직접 선택 (제안이 없거나 다를 때) */
  const [linkPick, setLinkPick] = useState<Record<number, string>>({});
  const linkPay = async (row: PayLinkRow, supplier: string) => {
    if (
      !(await ask({
        title: `「${supplier}」 지급으로 잡을까요?`,
        body: `${row.at} 출금 ${won(row.amount)}원 — 오래된 매입부터 차례로 채웁니다.`,
        confirmLabel: "지급 잡기",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payFromWithdrawal({ cashTxnId: row.id, supplier });
      if (!r.ok) return setError(r.error);
      setMsg(
        `지급 ${won(r.applied)}원 연결 — ${r.settled}건 완납${r.leftover > 0 ? ` · 출금의 ${won(r.leftover)}원은 미지급보다 커서 배분 안 됨` : ""}`,
      );
      router.refresh();
    });
  };

  const getForm = (s: PayableSupplier) =>
    form[s.supplier] ?? { amount: String(s.remain), method: "계좌이체", paidOn: kstToday() };

  const pay = async (s: PayableSupplier) => {
    const f = getForm(s);
    const amount = Number(f.amount.replace(/\D/g, ""));
    if (!amount) return setError("지급 금액을 적어 주세요");
    if (
      !(await ask({
        title: `${s.supplier}에 지급을 넣을까요?`,
        body: `${won(amount)}원 — 오래된 매입부터 차례로 채웁니다.`,
        confirmLabel: "지급 등록",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payToSupplier({ supplier: s.supplier, amount, method: f.method, paidOn: f.paidOn });
      if (!r.ok) return setError(r.error);
      setMsg(
        `지급 ${won(r.applied)}원 등록 — ${r.settled}건 완납${r.leftover > 0 ? ` · 잔액보다 커서 ${won(r.leftover)}원은 배분 안 됨` : ""}`,
      );
      router.refresh();
    });
  };

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}

      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4 text-center">
        <p className="text-xs text-slate-500">줄 돈 (미지급 잔액 전체)</p>
        <p className="tabular mt-1 text-xl font-bold text-red-600">{won(data.totalRemain)}원</p>
      </section>

      {/* ⭐ 정본 안내 (재설계 2026-08-25) — 계산서 돈 확인의 단일 답변처는 「돈 확인」 뷰 */}
      <section className="mt-4 rounded-card border-2 border-brand-500 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            <span className="font-semibold text-brand-700">세금계산서 기준 (정본)</span> —{" "}
            {Number(cashSummary.ym.slice(5, 7))}월 매입 계산서 중 출금 확인 안 됨{" "}
            <strong className="tabular">
              {cashSummary.n}건 · {won(cashSummary.sum)}원
            </strong>
          </p>
          <Link
            href="/finance/tax?view=money&direction=매입"
            className="shrink-0 rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700"
          >
            돈 확인 화면 →
          </Link>
        </div>
      </section>

      {/* 🔴 감사 P2 — 출금에서 지급 잡기: 이미 준 돈을 장부가 알게 하는 고리 */}
      {links.length > 0 && (
        <section className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
          <h2 className="font-semibold text-sky-900">출금에서 지급 잡기 ({links.length}건)</h2>
          <p className="mt-1 text-xs text-sky-800">
            매입대금으로 분류된 통장 출금 중 아직 지급 기록과 안 이어진 것 — 한 번씩 이어 주면
            미지급 잔액이 실제와 같아집니다
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {links.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {row.at} · {row.payer} · <strong>−{won(row.amount)}원</strong>
                </span>
                {row.suggest ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => linkPay(row, row.suggest!.supplier)}
                    className="shrink-0 rounded-lg bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    → {row.suggest.supplier} 지급 (잔액 {won(row.suggest.remain)})
                  </button>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <input
                      value={linkPick[row.id] ?? ""}
                      onChange={(e) => setLinkPick((p) => ({ ...p, [row.id]: e.target.value }))}
                      list="pay-supplier-names"
                      placeholder="거래처 검색…"
                      className="w-28 rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={pending || !supplierNames.includes((linkPick[row.id] ?? "").trim())}
                      onClick={() => linkPay(row, (linkPick[row.id] ?? "").trim())}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
                    >
                      지급
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.suppliers.length === 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          미지급 잔액이 없습니다 🎉
        </section>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {data.suppliers.map((s) => {
          const f = getForm(s);
          return (
            <li key={s.supplier} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/finance/party/${encodeURIComponent(`S:${s.supplier}`)}`}
                  className="font-semibold underline-offset-2 hover:underline"
                  title="이 거래처의 원장 보기"
                >
                  {s.supplier} <span className="text-xs font-normal text-slate-400">원장 →</span>
                </Link>
                <span className="tabular font-bold text-red-600">{won(s.remain)}원</span>
              </div>
              <p className="tabular mt-0.5 text-xs text-slate-500">
                미지급 {s.invoices.length}건{s.oldestD ? ` · 가장 오래된 것 ${s.oldestD}` : ""}
              </p>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 underline">매입별 잔액 보기</summary>
                <ul className="tabular mt-1 space-y-0.5 text-xs text-slate-600">
                  {s.invoices.map((inv) => (
                    <li key={inv.invoiceId} className="flex justify-between">
                      <span className="min-w-0 truncate">
                        {inv.d?.slice(5) ?? "?"} · {inv.invoiceNo}
                      </span>
                      <span>
                        {inv.paid > 0 && <span className="text-slate-400">{won(inv.paid)} 지급 · </span>}
                        잔액 {won(inv.remain)}원
                      </span>
                    </li>
                  ))}
                </ul>
              </details>

              {/* 지급 등록 */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  value={f.amount}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, amount: e.target.value.replace(/[^\d,]/g, "") } }))}
                  inputMode="numeric"
                  className="tabular w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
                  aria-label="지급 금액"
                />
                <select
                  value={f.method}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, method: e.target.value } }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={f.paidOn}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, paidOn: e.target.value } }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  aria-label="지급일"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pay(s)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  지급 등록
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <datalist id="pay-supplier-names">
        {supplierNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* 🔴 2026 감사 G2 — 「출금에서 지급 잡기」로 이은 출금 되돌리기 (출금 한 줄 = 지급 전체 원상복구) */}
      {linked.length > 0 && (
        <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            출금에서 이은 지급 {linked.length}건 (이 달) — 잘못 이었으면 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {linked.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.at} · {r.payer} · −{won(r.amount)}원 → 매입 {r.n}건에 {won(r.used)}원
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      !(await ask({
                        title: "이 출금의 지급 연결을 되돌릴까요?",
                        body: "이 출금으로 넣은 지급 기록이 지워지고 미지급 잔액이 도로 늘어납니다. 출금은 다시 이을 수 있습니다.",
                        tone: "danger",
                        confirmLabel: "되돌리기",
                      }))
                    )
                      return;
                    start(async () => {
                      setMsg(null);
                      setError(null);
                      const res = await undoPayFromWithdrawal(r.id);
                      if (!res.ok) return setError(res.error);
                      setMsg(`되돌렸습니다 — 지급 ${res.removed}건을 지우고 출금을 다시 열었습니다.`);
                      router.refresh();
                    });
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

      {/* 최근 지급 — 잘못 넣었으면 되돌리기 */}
      {data.recent.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-600">최근 지급 기록</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.paidOn} · {r.supplier} · {r.invoiceNo} · {won(r.amount)}원 ({r.method})
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    if (!(await ask({ title: "이 지급 기록을 되돌릴까요?", body: "미지급 잔액이 도로 늘어납니다. 출금에서 이은 지급이면 그 출금도 다시 열립니다.", tone: "danger", confirmLabel: "되돌리기" })))
                      return;
                    start(async () => {
                      setMsg(null);
                      setError(null);
                      const res = await removePurchasePayment(r.id);
                      if (!res.ok) return setError(res.error);
                      setMsg("되돌렸습니다.");
                      router.refresh();
                    });
                  }}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {confirmDialog}
    </>
  );
}
