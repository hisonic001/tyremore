"use client";

/**
 * ⭐ 자동 감사 배너 + 돈 추적 입구 (돈관리 근본책 1단계, 2026-08-31)
 *   매일 07:30 감사(cron)의 최신 결과를 보여주고, 「지금 다시 검사」로 즉시 다시 돌린다.
 *
 * ⭐ 자료가 바뀌면 돈관리를 열 때 저절로 다시 찍힌다 (2026-09-10 오후, self-audit.freshAuditRun) —
 *    전에는 하루 한 번 찍은 사진이라 오후에 정리한 14건이 저녁까지 ⚠ 로 남아 인박스·추적과
 *    말이 달랐다. 「몇 시 기준」은 여전히 적는다 — 검사 자체는 그 시각의 것이니까.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { runAuditNow } from "@/lib/trace-actions";
import type { AuditRun } from "@/lib/self-audit";

/** 「3시간 전」 — 사람 말로 (분·시간·일) */
function agoText(min: number): string {
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / (24 * 60))}일 전`;
}

export function AuditBanner({ audit }: { audit: AuditRun | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ok = audit !== null && audit.itemCount === 0;
  /** 반나절이 넘었으면 「지금과 다를 수 있다」를 눈에 띄게 */
  const stale = audit !== null && audit.ageMin >= 12 * 60;

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
              ? "정합성 검사 ✓ 이상 없음"
              : `⚠️ 정합성 검사 — 확인할 것 ${audit.itemCount}가지`}
        </span>
        {audit !== null && (
          <span className={`tabular text-xs ${stale ? "font-medium text-amber-800" : "text-slate-500"}`}>
            {audit.at} 기준 · {agoText(audit.ageMin)}
            {stale && " (지금과 다를 수 있어요)"}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Link href="/finance/trace" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
            🔍 돈 추적
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={runNow}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
              stale ? "border-amber-400 bg-white text-amber-800" : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {pending ? "검사 중…" : "🔄 지금 다시 검사"}
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
        매일 아침 7:30에 자동으로 돌고, <strong>자료가 바뀌면 이 화면을 열 때 저절로 다시 검사</strong>합니다 —
        하나 고치면 다른 데가 어긋나는 것을 기계가 잡습니다. 이상하면 「지금 다시 검사」를 눌러 주세요.
      </p>
    </div>
  );
}
