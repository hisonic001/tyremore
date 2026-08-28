"use client";

/**
 * ⭐ 외상 장부 — 대상 카드와 한꺼번에 털기 (사장님 지시 2026-08-17)
 *
 * 거래처를 펼쳐 받은 건들을 체크하고 한 번에 수금한다.
 * 받은 금액이 고른 합보다 적으면 **오래된 건부터** 채운다 (receivable-plan.ts).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { settleReceivables } from "@/lib/receivable";
import { planSettlement } from "@/lib/receivable-plan";
import type { ReceivableTarget } from "@/lib/receivable-book";

const won = (n: number) => n.toLocaleString("ko-KR");
const METHODS = ["현금", "카드", "계좌이체", "지역화폐"] as const;
/** 이보다 오래되면 붉게 — 눈에 띄어야 챙긴다 */
const OLD_DAYS = 90;

export function BookList({ targets, owner = false }: { targets: ReceivableTarget[]; owner?: boolean }) {
  return (
    <ul className="mt-3 space-y-2">
      {targets.map((t) => (
        <TargetCard key={t.key} t={t} owner={owner} />
      ))}
    </ul>
  );
}

/** 🔴 owner: 2회차 수리 E1(2026-08-28) — 수금은 사장님 전용. 직원에게는 목록만 보인다 */
function TargetCard({ t, owner }: { t: ReceivableTarget; owner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [method, setMethod] = useState<string>("현금");
  const today = new Date().toLocaleDateString("sv-SE");
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [confirm, setConfirm] = useState(false);

  const openSales = t.sales.filter((s) => s.remain > 0);
  const picked = openSales.filter((s) => sel[s.quoteId]);
  const pickedSum = picked.reduce((s, x) => s + x.remain, 0);
  /** 비우면 고른 것 전액 */
  const received = amount === "" ? pickedSum : Number(amount);

  /** 미리보기 — 서버와 **같은 함수**를 쓴다 (규칙이 갈라지지 않게) */
  const preview = useMemo(() => {
    if (picked.length === 0 || received <= 0) return null;
    return planSettlement(
      picked.map((s) => ({ quoteId: s.quoteId, quoteNo: s.quoteNo, remain: s.remain })),
      Math.min(received, pickedSum),
    );
  }, [picked, received, pickedSum]);

  const isSupplier = t.kind === "supplier";
  const old = t.oldestDays >= OLD_DAYS;

  function settle() {
    start(async () => {
      setErr(null);
      const r = await settleReceivables({
        quoteIds: picked.map((s) => s.quoteId),
        method,
        paidOn,
        memo: memo.trim() || null,
        received: amount === "" ? null : Number(amount),
      });
      if (!r.ok) {
        setConfirm(false);
        return setErr(r.error);
      }
      setMsg(
        `${won(r.applied)}원 받았습니다 — ${r.settled}건 처리` +
          (r.partialQuoteNo ? ` · ${r.partialQuoteNo} 은(는) 잔액이 남았습니다` : " · 전부 완납"),
      );
      setSel({});
      setAmount("");
      setMemo("");
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="w-full p-3 text-left lg:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">
            <span
              className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${
                isSupplier ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-600"
              }`}
            >
              {isSupplier ? "거래처" : t.kind === "customer" ? "손님" : "비회원"}
            </span>
            {t.label}
          </span>
          <span className="tabular shrink-0 font-bold text-amber-800">{won(t.remain)}원</span>
        </div>
        <div className="tabular mt-0.5 flex items-baseline justify-between gap-2 text-xs text-slate-500">
          <span>
            {t.count}건 · 받은 것 {won(t.paid)}원 / {won(t.total)}원
          </span>
          <span className={old ? "font-semibold text-red-600" : ""}>
            가장 오래된 것 {t.oldestDate.slice(5)} ({t.oldestDays}일){old && " ⚠️"}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-3">
          {msg && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
          {t.sales.length === 0 ? (
            <p className="text-sm text-slate-500">건별 목록을 못 실었습니다 — 필터로 좁혀 보세요.</p>
          ) : (
            <>
              {owner && (
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSel(Object.fromEntries(openSales.map((s) => [s.quoteId, true])))
                  }
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600"
                >
                  전부 체크
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSel(
                      Object.fromEntries(
                        openSales.filter((s) => s.ageDays >= OLD_DAYS).map((s) => [s.quoteId, true]),
                      ),
                    )
                  }
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600"
                >
                  {OLD_DAYS}일 이상만
                </button>
                {picked.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSel({})}
                    className="rounded-lg px-2.5 py-1 text-xs text-slate-400 underline"
                  >
                    체크 해제
                  </button>
                )}
              </div>
              )}

              <ul className="divide-y divide-slate-100">
                {t.sales.map((s) => {
                  const done = s.remain <= 0;
                  return (
                    <li key={s.quoteId} className="flex items-start gap-2 py-2">
                      <input
                        type="checkbox"
                        disabled={done || !owner}
                        hidden={!owner}
                        checked={!!sel[s.quoteId]}
                        onChange={(e) => setSel((v) => ({ ...v, [s.quoteId]: e.target.checked }))}
                        className="mt-1 h-4 w-4 shrink-0 accent-amber-700 disabled:opacity-30"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="tabular flex items-baseline gap-2 text-sm">
                          <span className="font-medium">{s.quoteNo}</span>
                          <span className="text-slate-500">{s.workDate.slice(5)}</span>
                          {s.plateNo && <span className="text-slate-400">{s.plateNo}</span>}
                          {s.ageDays >= OLD_DAYS && (
                            <span className="text-xs font-semibold text-red-600">{s.ageDays}일</span>
                          )}
                        </div>
                        <div className="truncate text-xs text-slate-500">{s.summary}</div>
                      </div>
                      <div className="tabular shrink-0 text-right text-sm">
                        {done ? (
                          <span className="text-emerald-700">완납 ✅</span>
                        ) : (
                          <>
                            <div className="font-semibold text-amber-800">{won(s.remain)}원</div>
                            {s.paid > 0 && (
                              <div className="text-xs text-slate-400">받음 {won(s.paid)}</div>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          {/* ── 한꺼번에 털기 ── */}
          {owner && picked.length > 0 && (
            <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-amber-900">
                  체크 {picked.length}건
                </span>
                <span className="tabular text-sm font-semibold text-amber-900">{won(pickedSum)}원</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      method === m ? "bg-amber-800 text-white" : "bg-white text-amber-900 ring-1 ring-amber-300"
                    }`}
                  >
                    {m}
                  </button>
                ))}
                <input
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  className="tabular rounded-lg border border-amber-300 px-2 py-1.5 text-xs"
                />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={amount === "" ? "" : Number(amount).toLocaleString()}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder={`받은 금액 (비우면 ${won(pickedSum)} 전액)`}
                  className="tabular min-w-0 flex-1 rounded-lg border border-amber-300 px-3 py-2 text-right text-sm"
                />
                {amount !== "" && (
                  <button
                    type="button"
                    onClick={() => setAmount("")}
                    className="shrink-0 text-xs text-amber-700 underline underline-offset-2"
                  >
                    전액
                  </button>
                )}
              </div>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="메모 (선택) — 예: 8월분 일괄 입금"
                className="mt-1.5 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
              />

              {/* 미리보기 — 서버와 같은 규칙 */}
              {preview && received < pickedSum && (
                <p className="tabular mt-2 rounded-lg bg-white px-3 py-2 text-xs text-amber-900">
                  오래된 것부터 채웁니다 — <strong>{preview.plan.length}건</strong>에 나눠 들어가고
                  {preview.partialQuoteNo ? (
                    <>
                      {" "}
                      <strong>{preview.partialQuoteNo}</strong> 은(는) 잔액이 남습니다
                    </>
                  ) : (
                    " 전부 완납됩니다"
                  )}
                </p>
              )}
              {received > pickedSum && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  고른 건들의 잔액({won(pickedSum)}원)보다 많이 받을 수 없습니다
                </p>
              )}

              {confirm ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirm(false)}
                    className="flex-1 rounded-lg border border-amber-300 bg-white py-2 text-sm font-medium text-amber-800"
                  >
                    그만두기
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={settle}
                    className="flex-1 rounded-lg bg-amber-700 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {pending ? "넣는 중…" : `${won(Math.min(received, pickedSum))}원 받은 것으로`}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending || received <= 0 || received > pickedSum}
                  onClick={() => setConfirm(true)}
                  className="mt-2 w-full rounded-lg bg-amber-800 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  한꺼번에 털기
                </button>
              )}
            </div>
          )}

          <div className="mt-3 text-right">
            <Link
              href={
                t.supplierName
                  ? `/sales?supplier=${encodeURIComponent(t.supplierName)}&pay=외상`
                  : t.customerId
                    ? `/sales?customer=${t.customerId}&pay=외상`
                    : `/sales?pay=외상&range=all`
              }
              className="text-xs text-slate-500 underline underline-offset-4"
            >
              정비 내역에서 보기 →
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
