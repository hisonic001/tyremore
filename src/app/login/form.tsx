"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/auth";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await login(id, pw);
      if (!r.ok) setError(r.error);
      else router.replace(next && next.startsWith("/") ? next : "/");
    });

  const FIELD =
    "w-full rounded-xl border-2 border-slate-300 px-4 py-4 text-xl outline-none focus:border-slate-900";

  return (
    <form
      className="mt-8 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        name="username"
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="아이디"
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        className={FIELD}
      />
      <input
        name="password"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="비밀번호"
        autoComplete="current-password"
        className={FIELD}
      />

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
      <p className="pt-1 text-center text-xs text-slate-400">
        한 번 로그인하면 이 기기에서 90일간 유지됩니다
      </p>
    </form>
  );
}
