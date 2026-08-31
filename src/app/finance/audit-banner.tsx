"use client";

/**
 * ⭐ 자동 감사 배너 + 돈 추적 입구 (돈관리 근본책 1단계, 2026-08-31)
 *   매일 07:30 감사(cron)의 최신 결과를 보여주고, 「지금 검사」로 즉시 다시 돌린다.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { runAuditNow } from "@/lib/trace-actions";
import type { AuditRun } from "@/lib/self-audit";

export function AuditBanner({ audit }: { audit: AuditRun | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ok = audit !== null && audit.itemCount === 0;

  const runNow = () =>
    start(async () => {
      setError(null);
      const r = await runAuditNow();
      if (!r.ok) return setError(r.error);
      router.refresh();
    });

  return (
    <div className={`mt-2 rounded-xl border p-3 ${ok ? "border-emerald-200 bg-emerald-50/60" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`font-semibold ${ok ? "text-emerald-800" : "text-amber-900"}`}>
          {audit === null
            ? "정합성 검사가 아직 안 돌았습니다"
            : ok
              ? `정합성 검사 ✓ 이상 없음 (${audit.at})`
              : `⚠️ 정합성 검사 — 확인할 것 ${audit.itemCount}가지 (${audit.at})`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Link href="/finance/trace" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            🔍 돈 추적
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={runNow}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 disabled:opacity-40"
          >
            {pending ? "검사 중…" : "지금 검사"}
          </button>
        </span>
      </div>
      {audit !== null && audit.itemCount > 0 && (
        <ul className="mt-2 space-y-2">
          {audit.items.map((it) => (
            <li key={it.code} className="text-xs text-amber-900">
              <Link href={it.href} className="font-semibold underline underline-offset-2">
                {it.title} — {it.n}건 →
              </Link>
              <ul className="tabular mt-0.5 space-y-0.5 pl-3 text-amber-800/90">
                {it.samples.map((sm, i) => (
                  <li key={i}>· {sm}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-700">⚠️ {error}</p>}
      <p className="mt-1.5 text-[11px] text-slate-500">
        매일 아침 7:30에 자동으로 돕니다 — 하나 고치면 다른 데가 어긋나는 것을 기계가 잡습니다.
      </p>
    </div>
  );
}
