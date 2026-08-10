"use client";

/** 감사 배너의 「MARS 에서 전기했음 — 정리」 단추 (2026-08-11) */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMarsResolved } from "@/lib/mars-audit-actions";

export function ResolveButton({ quoteId }: { quoteId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await markMarsResolved(quoteId);
            if (!r.ok) return setErr(r.error);
            router.refresh();
          })
        }
        className="ml-2 rounded border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 disabled:opacity-50"
        title="MARS 에서 전기까지 직접 확인한 경우에만 누르세요"
      >
        MARS 에서 확인했음 — 정리
      </button>
      {err && <span className="ml-1 text-xs text-red-600">{err}</span>}
    </>
  );
}
