import type { ReactNode } from "react";
import Link from "@/lib/link";
import { FinTabs, type FinTabId } from "./tabs";
import { MonthNav } from "./month-nav";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { reopenMonthForm } from "@/lib/month-close";

/**
 * ⭐ 돈 관리 페이지 셸 (ERP 구조화 배치1, 사장님 승인 2026-08-25)
 *
 *   7개 화면이 복붙하던 컨테이너·헤더·월네비의 단일 지점.
 *   🔴 PC 확장(lg:max-w-6xl)은 여기서만 정한다 — 돈 관리는 PC 중심(사장님 확정).
 *   pb-24는 우하단 HomeButton이 가리지 않게 하는 여백 — 지우지 말 것.
 *   (배치4에서 마감된 달 배너가 이 셸에 붙는다)
 */
export async function FinShell({
  tab,
  monthNav,
  closeNotice = true,
  children,
}: {
  tab: FinTabId;
  monthNav?: { ym: string; basePath: string; keep?: Record<string, string> };
  /** 마감된 달 배너 (현황은 자기 마감 섹션이 있어 끈다) */
  closeNotice?: boolean;
  children: ReactNode;
}) {
  // ⭐ 배치4 — 마감된 달이면 배너 (표가 아직 없으면 조용히 넘어간다)
  let closedAt: string | null = null;
  if (monthNav && closeNotice) {
    try {
      const r = await db.execute<{ d: string }>(sql`
        SELECT to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d
        FROM month_close WHERE ym = ${monthNav.ym} LIMIT 1
      `);
      closedAt = r[0]?.d ?? null;
    } catch {
      /* month_close 미생성 배포 순간 대비 */
    }
  }
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">돈 관리</h1>
        <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
          설정으로
        </Link>
      </header>
      <FinTabs tab={tab} />
      {monthNav && <MonthNav {...monthNav} />}
      {closedAt && monthNav && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-violet-50 px-3 py-1.5 text-xs text-violet-800">
          <span>
            🔒 {monthNav.ym}은 마감된 달입니다 ({closedAt}) — 고치면 마감 때 숫자와 달라질 수 있어요
          </span>
          <form action={reopenMonthForm.bind(null, monthNav.ym)}>
            <button type="submit" className="shrink-0 underline">
              마감 풀기
            </button>
          </form>
        </div>
      )}
      {children}
    </main>
  );
}
