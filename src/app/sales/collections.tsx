"use client";

/**
 * ⭐ 미수금 수금 패널 (사장님 선택 2026-08-11 · 제목 「외상 수금」→「미수금 수금」 2026-09-12 ERP 용어)
 * 외상 판매 카드를 펼치면 나온다 — 수금 이력과 입력.
 * 완납돼도 결제수단은 「외상」 그대로(DB 값) — 실수단으로 바꾸려면 「날짜·결제 고치기」.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCollection, removeCollection } from "@/lib/receivable";
import { COLLECT_METHODS } from "@/lib/payments";
import { W } from "@/lib/fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");
/** 수금 수단 = 분할에 섞을 수 있는 수단과 같다 — 정본은 lib/payments.ts (2026-08-29) */
// 「개인계좌」 포함 (2026-09-07) — 통장 밖 수령도 수단으로 남긴다
const METHODS: readonly string[] = COLLECT_METHODS;

/** 🔴 owner: 2회차 수리 E1(2026-08-28) — 수금 넣기·지우기는 사장님 전용.
 *  직원에게는 「얼마 받았고 얼마 남았나」만 보인다 (그건 매장에서 알아야 한다). */
export function CollectionPanel({
  quoteId,
  total,
  collections,
  owner = false,
  reserved = false,
}: {
  quoteId: number;
  total: number;
  collections: { id: number; amount: number; method: string; paidOn: string; memo: string | null }[];
  owner?: boolean;
  /** ⭐ 예약 건 (2026-09-10) — 「외상 수금」이 아니라 「예약금·잔금」이고, 완납되면 앱이 알아서 정리한다 */
  reserved?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("현금");
  const today = new Date().toLocaleDateString("sv-SE");
  const [paidOn, setPaidOn] = useState(today);
  const [askDel, setAskDel] = useState<number | null>(null);

  const paid = collections.reduce((s, c) => s + c.amount, 0);
  const remain = total - paid;

  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-amber-900">{reserved ? "📌 예약금·잔금 받기" : `${W.receivable} ${W.collect}`}</h3>
        <span className="tabular text-sm font-semibold text-amber-900">
          {remain > 0 ? `잔액 ${won(remain)}원` : "완납 ✅"}
          <span className="ml-2 font-normal text-amber-700">
            ({won(paid)} / {won(total)}원)
          </span>
        </span>
      </div>

      {collections.length > 0 && (
        <ul className="tabular mt-2 space-y-1 text-sm text-amber-900">
          {collections.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                {c.paidOn} · {c.method} {won(c.amount)}원{c.memo ? ` · ${c.memo}` : ""}
              </span>
              {!owner ? null : askDel === c.id ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErr(null);
                        const r = await removeCollection(c.id);
                        if (!r.ok) return setErr(r.error);
                        setAskDel(null);
                        router.refresh();
                      })
                    }
                    className="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-semibold text-red-600"
                  >
                    정말 지우기
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskDel(null)}
                    className="shrink-0 text-xs text-amber-700 underline"
                  >
                    취소
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setAskDel(c.id)}
                  className="shrink-0 text-xs text-amber-600 underline underline-offset-2"
                >
                  지우기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {owner && remain > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
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
          <div className="flex items-center gap-2">
            <input
              value={amount === "" ? "" : Number(amount).toLocaleString()}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder={`받은 금액 (잔액 ${won(remain)})`}
              className="tabular min-w-0 flex-1 rounded-lg border border-amber-300 px-3 py-2 text-right text-sm"
            />
            <button
              type="button"
              onClick={() => setAmount(String(remain))}
              className="shrink-0 text-xs text-amber-700 underline underline-offset-2"
            >
              전액
            </button>
            <button
              type="button"
              disabled={pending || amount === ""}
              onClick={() =>
                start(async () => {
                  setErr(null);
                  const r = await addCollection({ quoteId, amount: Number(amount), method, paidOn });
                  if (!r.ok) return setErr(r.error);
                  setAmount("");
                  router.refresh();
                })
              }
              className="shrink-0 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              수금
            </button>
          </div>
        </div>
      )}
      {remain <= 0 && (
        <p className="mt-1.5 text-xs text-amber-700">
          {reserved
            ? "다 받았습니다 — 개인계좌로 받은 몫이 섞여 보통 결제로 정리하지 못했습니다. MARS 에 올리려면 「날짜·결제 고치기」에서 실제 받은 수단으로 바꾸세요."
            : "다 받았습니다. MARS 에 올리려면 「날짜·결제 고치기」에서 실제 받은 수단으로 바꾸세요."}
        </p>
      )}
      {err && <p className="mt-1.5 text-xs text-red-600">{err}</p>}
    </div>
  );
}
