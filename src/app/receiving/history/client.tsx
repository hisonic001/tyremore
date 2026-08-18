"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePurchaseInvoice, deletePurchaseLine, updatePurchaseCost } from "@/lib/purchase-edit";
import type { PurchaseDay, PurchaseInvoiceRow, PurchaseLine } from "@/lib/purchase-history";

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
export function HistoryList({ days, owner }: { days: PurchaseDay[]; owner: boolean }) {
  return (
    <div className="mt-4 space-y-5">
      {days.map((d) => (
        <section key={d.date}>
          <h2 className="mb-2 flex items-baseline justify-between gap-3">
            <span className="font-bold">{dayLabel(d.date)}</span>
            <span className="tabular text-sm text-slate-500">
              {d.qty}{d.unit}{d.amount !== null && ` · ${won(d.amount)}원`}
            </span>
          </h2>
          <ul className="space-y-2">
            {d.invoices.map((inv) => (
              <InvoiceCard key={inv.invoiceId} inv={inv} owner={owner} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function InvoiceCard({ inv, owner }: { inv: PurchaseInvoiceRow; owner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 🔴 장부째 지우기는 두 번 묻는다 — 재고까지 되돌아가기 때문 */
  const [askDelete, setAskDelete] = useState(false);

  function removeInvoice() {
    start(async () => {
      setError(null);
      const r = await deletePurchaseInvoice(inv.invoiceId);
      if (!r.ok) {
        setAskDelete(false);
        return setError(r.error);
      }
      setNotice(`지웠습니다 — ${r.note}`);
      router.refresh();
    });
  }

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
            {inv.qty}{inv.unit}{inv.amount !== null && ` · ${won(inv.amount)}원`}
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
              {inv.receivedQty}/{inv.qty}{inv.unit} 도착
            </span>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {inv.lines.length > 0 ? (open ? "접기 ▲" : `품목 ${inv.lines.length}개 ▼`) : "품목 없음"}
          </span>
        </div>
      </button>

      {open && inv.lines.length > 0 && (
        <>
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {inv.lines.map((l) => (
              <LineRow key={l.itemId} l={l} owner={owner} onMessage={setNotice} />
            ))}
          </ul>

          {error && <p className="whitespace-pre-line px-3 py-2 text-sm text-red-600">{error}</p>}
          {notice && <p className="px-3 py-2 text-sm text-emerald-700">{notice}</p>}

          {/* ⭐ 수정·지우기 (사장님 요청 2026-08-09) — 지우면 입고된 재고까지 되돌아간다 */}
          <div className="border-t border-slate-100 p-3">
            {askDelete ? (
              <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-800">
                  이 매입의 입고분({inv.receivedQty}{inv.unit})을 재고에서 되돌리고 기록을 지웁니다. 되돌릴 수 없습니다.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setAskDelete(false)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-600"
                  >
                    그만두기
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={removeInvoice}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {pending ? "지우는 중…" : "정말 지우기"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setAskDelete(true);
                }}
                className="w-full rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 active:bg-red-50"
              >
                이 매입 지우기 (재고도 되돌림)
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * 매입 줄 하나 — 매입가 고치기(사장님만)와 줄 지우기.
 * 줄을 지우면 그 줄로 입고된 본이 재고에서 같이 빠진다 (purchase-edit.ts).
 */
function LineRow({ l, owner, onMessage }: { l: PurchaseLine; owner: boolean; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState(l.unitCost !== null ? String(l.unitCost) : "");
  const [ask, setAsk] = useState(false);

  const saveCost = () => {
    const v = cost === "" ? null : Number(cost);
    if (v === l.unitCost) return;
    start(async () => {
      setError(null);
      const r = await updatePurchaseCost({ itemId: l.itemId, unitCost: v });
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  const removeLine = () => {
    start(async () => {
      setError(null);
      const r = await deletePurchaseLine(l.itemId);
      if (!r.ok) {
        setAsk(false);
        return setError(r.error);
      }
      onMessage(`줄을 지웠습니다 — ${r.note}`);
      router.refresh();
    });
  };

  return (
    <li className="px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="tabular text-sm font-medium">{l.spec ?? l.cai}</div>
          <div className="truncate text-xs text-slate-500">{l.model ?? l.description}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="tabular text-right text-sm">
            <div className="font-semibold">
              {l.qty}{l.unit}
              {l.receivedQty > 0 && l.receivedQty < l.qty && (
                <span className="ml-1 text-xs font-normal text-amber-700">({l.receivedQty} 도착)</span>
              )}
            </div>
            {/* 매입가 — 사장님은 그 자리에서 고친다. 재고의 원가도 같이 맞춰진다 */}
            {owner ? (
              <label className="mt-0.5 flex items-center justify-end gap-1 text-xs text-slate-500">
                {l.unit}당
                <input
                  value={cost === "" ? "" : Number(cost).toLocaleString()}
                  onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
                  onBlur={saveCost}
                  inputMode="numeric"
                  placeholder="—"
                  className="tabular h-8 w-24 rounded-lg border border-slate-300 px-2 text-right text-xs"
                />
                원
              </label>
            ) : l.unitCost !== null ? (
              <div className="text-xs text-slate-500">{l.unit}당 {won(l.unitCost)}원</div>
            ) : null}
          </div>
          {ask ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={pending}
                onClick={removeLine}
                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "…" : `정말 (${l.receivedQty}${l.unit}↩)`}
              </button>
              <button type="button" onClick={() => setAsk(false)} className="text-xs text-slate-500">
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="이 줄 지우기"
              onClick={() => {
                setError(null);
                setAsk(true);
              }}
              className="px-1.5 text-slate-300 active:text-red-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-1 whitespace-pre-line text-xs text-red-600">{error}</p>}
    </li>
  );
}
