"use client";

import { useState, useTransition } from "react";
import { changeMyPassword } from "@/lib/user-admin";

/** ⭐ 내 비밀번호 바꾸기 — 누구나, 현재 비밀번호 확인 후 (사장님 요청 2026-08-08) */
export function ChangePassword() {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-lg border border-slate-300 py-3 font-medium text-slate-600"
      >
        비밀번호 바꾸기
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
      <input
        type="password"
        value={cur}
        onChange={(e) => setCur(e.target.value)}
        placeholder="현재 비밀번호"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="새 비밀번호 (4자 이상)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
      />
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMsg(null);
          }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending || next.length < 4}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await changeMyPassword(cur, next);
              if (!r.ok) return setMsg(`⚠️ ${r.error}`);
              setMsg("바꿨습니다 ✅ 다음 로그인부터 새 비밀번호를 쓰세요");
              setCur("");
              setNext("");
            })
          }
          className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          바꾸기
        </button>
      </div>
    </div>
  );
}
