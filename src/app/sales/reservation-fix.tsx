"use client";

/**
 * ⭐ 예약 「받은 돈 고치기」 (사장님 지적 2026-09-10)
 *
 *   실측: 예약중 8건 전부 「전액 받음」으로 저장돼 있었다 — 등록 때 예약을 체크하고 카드만
 *   누르고 금액을 비우면 전액 카드로 굳었기 때문(권미선 20만원 예약금이 메모 글자로만 남음).
 *   정비 내역 카드에는 이걸 고칠 자리가 없었다. 이 패널이 그 자리다:
 *     「안 받음」 → 전액 잔금 / 「받음」 → 수단·금액·날짜 여러 줄 → 저장
 *   저장하면 판매는 「외상 + 받은 몫」 모양이 되고(정본 reservation-pay.ts), 잔금까지 다 받으면
 *   앱이 알아서 보통 결제로 되돌린다.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restateReservationPaid, type PaidPart } from "@/lib/reservation-pay";
import { COLLECT_METHODS } from "@/lib/payments";

const won = (n: number) => n.toLocaleString("ko-KR");

export function ReservationFixPanel({
  quoteId,
  total,
  paymentMethod,
  memo,
}: {
  quoteId: number;
  total: number;
  paymentMethod: string | null;
  /** 판매 메모 — 「20만원 예약금_카드」 같은 힌트가 여기 있다 */
  memo: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const today = new Date().toLocaleDateString("sv-SE");
  const [parts, setParts] = useState<{ method: string; amount: string; paidOn: string }[]>([
    { method: paymentMethod && COLLECT_METHODS.includes(paymentMethod) ? paymentMethod : "카드", amount: "", paidOn: today },
  ]);
  const sum = parts.reduce((s, p) => s + Number(p.amount || "0"), 0);

  const save = (list: PaidPart[]) =>
    start(async () => {
      setErr(null);
      const r = await restateReservationPaid({ quoteId, parts: list });
      if (!r.ok) return setErr(r.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">
      <p className="font-semibold">⚠ 이 예약은 {won(total)}원을 {paymentMethod ?? "전액"}로 다 받은 것으로 저장돼 있습니다</p>
      <p className="mt-0.5 text-xs text-violet-800">
        예약금을 일부만 받으셨거나 아직 안 받으셨으면 실제대로 고쳐 주세요 — 잔금이 따로 잡히고, 다 받으면 알아서 정리됩니다.
        {memo && (
          <>
            {" "}
            메모: <strong>{memo}</strong>
          </>
        )}
      </p>
      {!open ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save([])}
            className="rounded-lg border border-violet-400 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 disabled:opacity-50"
          >
            아직 안 받음 (전액 잔금)
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(true)}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            일부 받음 — 금액 적기
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {parts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <select
                value={p.method}
                onChange={(e) => setParts((a) => a.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}
                className="rounded-lg border border-violet-300 bg-white px-2 py-1.5 text-xs"
              >
                {COLLECT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={p.amount === "" ? "" : Number(p.amount).toLocaleString()}
                onChange={(e) =>
                  setParts((a) => a.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/\D/g, "") } : x)))
                }
                inputMode="numeric"
                placeholder="받은 금액"
                className="tabular w-32 rounded-lg border border-violet-300 px-2 py-1.5 text-right text-xs"
              />
              <input
                type="date"
                value={p.paidOn}
                onChange={(e) => setParts((a) => a.map((x, j) => (j === i ? { ...x, paidOn: e.target.value } : x)))}
                title="받은 날"
                className="tabular rounded-lg border border-violet-300 px-2 py-1.5 text-xs"
              />
              {parts.length > 1 && (
                <button
                  type="button"
                  onClick={() => setParts((a) => a.filter((_, j) => j !== i))}
                  className="text-xs text-violet-600 underline"
                >
                  빼기
                </button>
              )}
            </div>
          ))}
          {parts.length < 5 && (
            <button
              type="button"
              onClick={() => setParts((a) => [...a, { method: "현금", amount: "", paidOn: today }])}
              className="text-xs text-violet-700 underline underline-offset-2"
            >
              + 수단 하나 더
            </button>
          )}
          <p className="tabular text-xs">
            받은 돈 <strong>{won(sum)}원</strong> · 잔금 <strong>{won(Math.max(0, total - sum))}원</strong>
            {sum > total && <span className="ml-2 font-semibold text-red-600">합계보다 많습니다</span>}
            {sum === total && <span className="ml-2 text-emerald-700">전액 — 보통 결제로 정리됩니다</span>}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg border border-violet-300 bg-white py-2 text-xs font-medium text-violet-800"
            >
              그만두기
            </button>
            <button
              type="button"
              disabled={pending || sum <= 0 || sum > total}
              onClick={() =>
                save(parts.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), paidOn: p.paidOn })))
              }
              className="flex-1 rounded-lg bg-violet-700 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {pending ? "저장 중…" : "이대로 고치기"}
            </button>
          </div>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}
