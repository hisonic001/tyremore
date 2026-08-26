"use client";

import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { DATA_START, kstToday, ymAdd } from "@/lib/ym";

/**
 * ⭐ 달 넘기기 정본 (배치1, 2026-08-25 → 개선 2026-08-26)
 *
 *   사장님 지적: "2025년으로 돌아가려면 화살표를 여러 번 눌러야 해서 불편" —
 *   가운데 달 표시를 **고르는 칸**으로 바꾸고(자료 시작 2025-01부터 한 번에 이동),
 *   ◀◀/▶▶ 로 1년씩도 점프한다. 미래 달은 잠근다.
 */

export function MonthNav({ ym, basePath, keep }: { ym: string; basePath: string; keep?: Record<string, string> }) {
  const router = useRouter();
  const thisYm = kstToday().slice(0, 7);
  const href = (m: string) => {
    const p = new URLSearchParams(keep);
    p.set("ym", m);
    return `${basePath}?${p.toString()}`;
  };
  // 자료 시작 ~ 이번 달 목록 (최신이 위)
  const options: string[] = [];
  for (let m = thisYm; m >= DATA_START; m = ymAdd(m, -1)) options.push(m);

  const clamp = (m: string) => (m > thisYm ? thisYm : m < DATA_START ? DATA_START : m);
  const arrow = "rounded-control px-2 py-2.5 text-slate-500 active:bg-slate-200 lg:hover:bg-slate-100";
  const dead = "px-2 py-2.5 text-slate-300";

  return (
    <nav className="tabular mt-2 flex items-center justify-center gap-1 text-sm">
      {ym > DATA_START ? (
        <Link href={href(clamp(ymAdd(ym, -12)))} className={arrow} aria-label="1년 전">
          ◀◀
        </Link>
      ) : (
        <span className={dead}>◀◀</span>
      )}
      {ym > DATA_START ? (
        <Link href={href(ymAdd(ym, -1))} className={arrow} aria-label="한 달 전">
          ◀
        </Link>
      ) : (
        <span className={dead}>◀</span>
      )}
      <select
        value={ym}
        onChange={(e) => router.push(href(e.target.value))}
        aria-label="달 고르기"
        className="tabular rounded-control border border-slate-300 bg-white px-2 py-2 font-bold focus:border-brand-500 focus:outline-none"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {ym < thisYm ? (
        <Link href={href(ymAdd(ym, 1))} className={arrow} aria-label="한 달 뒤">
          ▶
        </Link>
      ) : (
        <span className={dead}>▶</span>
      )}
      {ym < thisYm ? (
        <Link href={href(clamp(ymAdd(ym, 12)))} className={arrow} aria-label="1년 뒤">
          ▶▶
        </Link>
      ) : (
        <span className={dead}>▶▶</span>
      )}
    </nav>
  );
}
