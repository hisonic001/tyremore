"use client";

/**
 * ⭐ 정비 내역 결제수단 칩 (사장님 요청 2026-08-07)
 *
 *   기간 필터 본체는 2026-08-29 에 `components/ui/period-filter.tsx` 로 옮겼다 —
 *   매입 내역도 같은 기간 필터를 쓰게 되면서, 두 벌이 되면 「오늘」의 뜻이 갈리기 때문이다.
 *   여기 남은 것은 **정비 내역에만 있는 결제수단 줄**이고, 기간 필터의 `extra` 슬롯으로 들어간다.
 */

import { useRouter } from "next/navigation";

export function PayFilter({
  pay,
  payOptions,
  keep,
}: {
  /** null 이면 전체 */
  pay: string | null;
  payOptions: readonly string[];
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const go = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    router.push(`/sales${p.toString() ? `?${p.toString()}` : ""}`);
  };
  const chip = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-400">결제</span>
      <button type="button" onClick={() => go({ pay: undefined })} className={chip(!pay)}>
        전체
      </button>
      {payOptions.map((p) => (
        <button key={p} type="button" onClick={() => go({ pay: p })} className={chip(pay === p)}>
          {p}
        </button>
      ))}
    </div>
  );
}
