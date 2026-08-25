import Link from "@/lib/link";
import { kstToday, ymAdd } from "@/lib/ym";

/**
 * ⭐ 달 넘기기 정본 (ERP 구조화 배치1, 2026-08-25) — 4곳에 복붙돼 있던 월 네비 수렴.
 *   미래 달 비활성. ym 파싱은 각 page.tsx가 pickYm(lib/ym)으로.
 */
export function MonthNav({ ym, basePath, keep }: { ym: string; basePath: string; keep?: Record<string, string> }) {
  const thisYm = kstToday().slice(0, 7);
  const href = (m: string) => {
    const p = new URLSearchParams(keep);
    p.set("ym", m);
    return `${basePath}?${p.toString()}`;
  };
  return (
    <nav className="tabular mt-2 flex items-center justify-center gap-4 text-sm">
      <Link href={href(ymAdd(ym, -1))} className="rounded-control px-3 py-2.5 active:bg-slate-200">
        ◀ {ymAdd(ym, -1)}
      </Link>
      <span className="font-bold">{ym}</span>
      {ym < thisYm ? (
        <Link href={href(ymAdd(ym, 1))} className="rounded-control px-3 py-2.5 active:bg-slate-200">
          {ymAdd(ym, 1)} ▶
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-slate-300">다음 달</span>
      )}
    </nav>
  );
}
