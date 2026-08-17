"use client";

/** 외상 장부 필터 — 정비 내역 필터와 같은 방식(칩 + 주소 갈아끼우기) */

import { useRouter } from "next/navigation";

export function BookFilter({
  kind,
  includeSettled,
}: {
  kind: "supplier" | "customer" | null;
  includeSettled: boolean;
}) {
  const router = useRouter();
  const go = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      kind: kind ?? undefined,
      settled: includeSettled ? "1" : undefined,
      ...over,
    })) {
      if (v) p.set(k, v);
    }
    router.push(`/receivables${p.toString() ? `?${p.toString()}` : ""}`);
  };
  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => go({ kind: undefined })} className={chip(!kind)}>
        전체
      </button>
      <button type="button" onClick={() => go({ kind: "supplier" })} className={chip(kind === "supplier")}>
        거래처
      </button>
      <button type="button" onClick={() => go({ kind: "customer" })} className={chip(kind === "customer")}>
        개인 손님
      </button>
      <button
        type="button"
        onClick={() => go({ settled: includeSettled ? undefined : "1" })}
        className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-medium ${
          includeSettled ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"
        }`}
      >
        완납도 보기
      </button>
    </div>
  );
}
