"use client";

/**
 * ⭐ 할 일 인박스 화면 (돈관리 근본책 2단계, 2026-08-31)
 *   자료는 서버(fin-inbox 정본)가 만들고, 여기는 그리기 + 확실한 두 액션만:
 *   ⚡ 판매↔입금 대조(traceLinkDeposit) · 지급 대조(payFromWithdrawal) — 정본 재사용.
 *   화면 글자는 fin-words 정본(ERP 용어, 2026-09-12).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { FinInbox, InboxEntry } from "@/lib/fin-inbox";
import { markSaleSettledAside, traceLinkDeposit } from "@/lib/trace-actions";
import { payFromWithdrawal } from "@/lib/purchase-pay";
import { useConfirm } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";

export function InboxSection({ inbox, ym }: { inbox: FinInbox; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const empty = inbox.groups.length === 0 && !inbox.expenseNote;

  const doLink = async (e: InboxEntry) => {
    const a = e.linkDeposit!;
    if (!(await ask({ title: `입금과 ${W.recon}할까요?`, body: `${e.text}\n↔ ${a.label}`, confirmLabel: W.recon }))) return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await traceLinkDeposit(a.cashTxnId, a.quoteId);
      if (!r.ok) return setError(r.error);
      setMsg(`${W.recon}했습니다 — 입금자명도 기억했습니다.`);
      router.refresh();
    });
  };

  /* 통장에 안 찍히는 수령(개인계좌·현금) — 대조 제외 표시 (사장님 제보 2026-09-01 나기춘) */
  const doAside = async (e: InboxEntry) => {
    const a = e.aside!;
    if (
      !(await ask({
        title: "개인계좌·현금으로 받은 판매인가요?",
        body: `${e.text}
법인 통장에 안 찍히는 돈이라 ${W.excluded}로 표시합니다. 잘못 표시했으면 「${W.activity}」에서 되돌릴 수 있습니다.`,
        confirmLabel: `받았음 — ${W.excluded}`,
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await markSaleSettledAside(a.quoteId);
      if (!r.ok) return setError(r.error);
      setMsg(`${W.excluded}로 표시했습니다.`);
      router.refresh();
    });
  };

  const doPay = async (e: InboxEntry) => {
    const a = e.payFrom!;
    if (!(await ask({ title: `「${a.supplier}」 ${W.reconPay}할까요?`, body: `${e.text} — 오래된 매입부터 채웁니다.`, confirmLabel: W.reconPay }))) return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payFromWithdrawal({ cashTxnId: a.cashTxnId, supplier: a.supplier });
      if (!r.ok) return setError(r.error);
      setMsg(`지급 ${r.applied.toLocaleString()}원을 ${W.recon}했습니다.`);
      router.refresh();
    });
  };

  return (
    <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
      {confirmDialog}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">할 일 인박스</h2>
        <span className="text-xs text-slate-400">상대별 · 이 달</span>
      </div>
      {msg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {msg}</p>}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}

      {empty ? (
        <p className="mt-2 text-sm text-slate-500">남은 할 일이 없습니다 🎉</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {inbox.groups.map((g) => (
            <li key={g.key} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                {g.partyHref ? (
                  <Link href={g.partyHref} className="min-w-0 truncate text-sm font-semibold underline-offset-2 hover:underline">
                    {g.label} <span className="text-xs font-normal text-slate-400">원장 →</span>
                  </Link>
                ) : (
                  <Link
                    href={`/finance/trace?q=${encodeURIComponent(g.label)}`}
                    className="min-w-0 truncate text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    {g.label} <span className="text-xs font-normal text-slate-400">추적 →</span>
                  </Link>
                )}
                <span className="tabular shrink-0 text-xs text-slate-500">{g.entries.length}건</span>
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {g.entries.map((e, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`min-w-0 flex-1 ${e.tone === "warn" ? "text-amber-800" : "text-slate-600"}`}>
                        {e.tone === "warn" ? "⚠️ " : ""}
                        {e.text}
                      </span>
                      {e.linkDeposit && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doLink(e)}
                          className="shrink-0 rounded-lg bg-sky-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          ⚡ {e.linkDeposit.label}
                        </button>
                      )}
                      {e.payFrom && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doPay(e)}
                          className="shrink-0 rounded-lg bg-sky-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          → {e.payFrom.label}
                        </button>
                      )}
                      {e.aside && !e.linkDeposit && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => doAside(e)}
                          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
                        >
                          개인계좌·현금으로 받음
                        </button>
                      )}
                      {!e.linkDeposit && !e.payFrom && e.href && (
                        <Link href={e.href} className="shrink-0 text-slate-400 underline underline-offset-2">
                          가서 하기 →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {inbox.moreGroups > 0 && (
        <p className="mt-2 text-xs text-slate-400">그 밖 {inbox.moreGroups}상대 — 각 화면·추적에서 볼 수 있습니다.</p>
      )}
      {inbox.expenseNote && (
        <p className="mt-2 text-xs text-slate-500">
          <Link href={`/finance/expenses?ym=${ym}`} className="underline underline-offset-2">
            {inbox.expenseNote} →
          </Link>
        </p>
      )}
    </section>
  );
}
