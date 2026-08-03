"use client";

import { useState } from "react";
import type { PurchaseDay, PurchaseInvoiceRow } from "@/lib/purchase-history";

const won = (n: number) => n.toLocaleString();

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** '2026-08-03' → '8월 3일 (월)' */
function dayLabel(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(`${d}T00:00:00`);
  return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WEEK[dt.getDay()]})`;
}

const STATUS_STYLE: Record<string, string> = {
  입고대기: "bg-amber-100 text-amber-900",
  부분입고: "bg-sky-100 text-sky-800",
  입고완료: "bg-emerald-100 text-emerald-800",
};

/**
 * 날짜별 매입 내역.
 * 접어서 보여준다 — 하루에 여러 건이면 품목까지 펼쳐 두면 눈이 못 따라간다.
 * 누르면 그 장부의 품목이 나온다.
 */
export function HistoryList({ days }: { days: PurchaseDay[] }) {
  return (
    <div className="mt-4 space-y-5">
      {days.map((d) => (
        <section key={d.date}>
          <h2 className="mb-2 flex items-baseline justify-between gap-3">
            <span className="font-bold">{dayLabel(d.date)}</span>
            <span className="tabular text-sm text-slate-500">
              {d.qty}본{d.amount !== null && ` · ${won(d.amount)}원`}
            </span>
          </h2>
          <ul className="space-y-2">
            {d.invoices.map((inv) => (
              <InvoiceCard key={inv.invoiceId} inv={inv} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function InvoiceCard({ inv }: { inv: PurchaseInvoiceRow }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-3 text-left active:bg-slate-50"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-semibold">
            {inv.supplier}
            {inv.isManual && <span className="ml-2 text-xs font-normal text-slate-400">직접 매입</span>}
          </span>
          <span className="tabular text-sm text-slate-500">
            {inv.qty}본{inv.amount !== null && ` · ${won(inv.amount)}원`}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}
          >
            {inv.status}
          </span>
          <span className="tabular text-xs text-slate-400">{inv.invoiceNo}</span>
          {inv.status !== "입고완료" && inv.qty > 0 && (
            <span className="tabular text-xs text-amber-700">
              {inv.receivedQty}/{inv.qty}본 도착
            </span>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {inv.lines.length > 0 ? (open ? "접기 ▲" : `품목 ${inv.lines.length}개 ▼`) : "품목 없음"}
          </span>
        </div>
      </button>

      {open && inv.lines.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {inv.lines.map((l) => (
            <li key={l.itemId} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="tabular text-sm font-medium">{l.spec ?? l.cai}</div>
                <div className="truncate text-xs text-slate-500">{l.model ?? l.description}</div>
              </div>
              <div className="tabular shrink-0 text-right text-sm">
                <div className="font-semibold">
                  {l.qty}본
                  {l.receivedQty > 0 && l.receivedQty < l.qty && (
                    <span className="ml-1 text-xs font-normal text-amber-700">({l.receivedQty} 도착)</span>
                  )}
                </div>
                {l.unitCost !== null ? (
                  <div className="text-xs text-slate-500">
                    본당 {won(l.unitCost)}원
                    {l.amount !== null && <span className="ml-1 text-slate-400">· {won(l.amount)}</span>}
                  </div>
                ) : (
                  <div className="text-xs text-slate-300">—</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
