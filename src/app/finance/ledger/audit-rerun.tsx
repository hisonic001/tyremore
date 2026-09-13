"use client";

/**
 * 장부 #audit 「지금 다시 검사」 단추 (5단계, 2026-09-13 — 사장님 결정 8)
 *   옛 첫 화면 배너(audit-banner.tsx, 5단계에 삭제)의 runNow 단추를 그대로 옮겼다.
 *   검사 자체는 서버 액션 runAuditNow(cron 과 같은 runAndSaveAudit) — 여기는 누르고 새로 그리기만.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runAuditNow } from "@/lib/trace-actions";
import { W } from "@/lib/fin-words";

export function AuditRerun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await runAuditNow();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
      >
        {pending ? "검사 중…" : W.auditRerun}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
