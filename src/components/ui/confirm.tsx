"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * ⭐ 확인 시트 (디자인 리프레시 배치1) — 브라우저 confirm() 10곳의 대체
 *
 *   모바일=하단 시트(슬라이드업), sm 이상=중앙 모달. Promise 기반이라
 *   `if (!confirm("..")) return` → `if (!(await ask({ title })))return` 한 줄 교체.
 *   본문은 whitespace-pre-line — 기존 \n 다중 줄 메시지를 그대로 받는다.
 *   취소가 왼쪽·같은 크기(오조작 방지), 위험 액션은 tone:"danger"로 빨강.
 */
export interface ConfirmOpts {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

export function useConfirm(): [(opts: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{ opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);

  const ask = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  const dialog = state ? (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="닫기"
        onClick={() => close(false)}
        className="absolute inset-0 animate-[fade-in_150ms_ease-out] bg-black/40"
      />
      <div className="relative w-full max-w-md animate-[sheet-up_200ms_ease-out] rounded-t-2xl bg-white p-5 pb-7 shadow-float sm:animate-[fade-in_150ms_ease-out] sm:rounded-card sm:pb-5">
        <p className="text-lg font-bold">{state.opts.title}</p>
        {state.opts.body && (
          <p className="mt-2 whitespace-pre-line text-[15px] leading-snug text-slate-600">{state.opts.body}</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="min-h-[3.25rem] rounded-control border border-slate-300 bg-white text-base font-semibold text-slate-700 active:bg-slate-100"
          >
            {state.opts.cancelLabel ?? "아니요"}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`min-h-[3.25rem] rounded-control text-base font-semibold text-white active:opacity-90 ${
              state.opts.tone === "danger" ? "bg-red-600" : "bg-brand-600"
            }`}
          >
            {state.opts.confirmLabel ?? "네, 할게요"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [ask, dialog];
}
