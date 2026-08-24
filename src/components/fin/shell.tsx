import type { ReactNode } from "react";
import Link from "@/lib/link";
import { FinTabs, type FinTabId } from "./tabs";
import { MonthNav } from "./month-nav";

/**
 * ⭐ 돈 관리 페이지 셸 (ERP 구조화 배치1, 사장님 승인 2026-08-25)
 *
 *   7개 화면이 복붙하던 컨테이너·헤더·월네비의 단일 지점.
 *   🔴 PC 확장(lg:max-w-6xl)은 여기서만 정한다 — 돈 관리는 PC 중심(사장님 확정).
 *   pb-24는 우하단 HomeButton이 가리지 않게 하는 여백 — 지우지 말 것.
 *   (배치4에서 마감된 달 배너가 이 셸에 붙는다)
 */
export function FinShell({
  tab,
  monthNav,
  children,
}: {
  tab: FinTabId;
  monthNav?: { ym: string; basePath: string; keep?: Record<string, string> };
  children: ReactNode;
}) {
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
      {children}
    </main>
  );
}
