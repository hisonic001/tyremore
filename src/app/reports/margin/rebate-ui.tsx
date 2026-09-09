"use client";

/**
 * ⭐ 뒷마진(제조사 장려금) 화면 부품 (2026-09-09)
 *
 *   추정 카드는 서버(page.tsx)가 그린다 — 여기는 확정 등록 폼과 목록만.
 *   확정 = 크레딧 메모·매출할인이 실제로 도착해 금액이 정해진 것.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addRebateEntry, deleteRebateEntry, type RebateEntry } from "@/lib/rebate";

const won = (n: number) => n.toLocaleString("ko-KR");
const FIELD = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900";

export function RebateEntries({ ym, entries }: { ym: string; entries: RebateEntry[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">확정된 뒷마진 (도착분)</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-50"
        >
          {open ? "닫기" : "+ 확정 등록"}
        </button>
      </div>

      {entries.length > 0 ? (
        <ul className="tabular mt-2 space-y-1 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {e.title}
                {e.memo && <span className="ml-1 text-xs text-slate-400">· {e.memo}</span>}
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <strong>{won(e.amount)}원</strong>
                {confirmId === e.id ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await deleteRebateEntry(e.id);
                          if (!r.ok) setError(r.error);
                          setConfirmId(null);
                          router.refresh();
                        })
                      }
                      className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white"
                    >
                      정말 지우기
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="text-xs text-slate-400">
                      취소
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmId(e.id)} className="text-xs text-slate-300 active:text-red-500">
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-slate-400">
          아직 없음 — 크레딧 메모·매출할인이 도착하면 여기 등록해야 마진 합계에 들어갑니다 (추정은 참고용).
        </p>
      )}

      {open && (
        <div className="mt-2.5 space-y-2 rounded-xl bg-slate-50 p-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="이름 (예: 미쉐린 8월 타겟 보너스)" className={`${FIELD} w-full`} />
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ""))}
              placeholder="금액(원)"
              inputMode="numeric"
              className={`${FIELD} w-36`}
            />
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" className={`${FIELD} flex-1`} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await addRebateEntry({ ym, title, amount: Number(amount || 0), memo });
                if (!r.ok) return setError(r.error);
                setTitle(""); setAmount(""); setMemo(""); setOpen(false);
                router.refresh();
              })
            }
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "등록 중…" : `${ym} 귀속으로 등록`}
          </button>
        </div>
      )}
    </div>
  );
}
