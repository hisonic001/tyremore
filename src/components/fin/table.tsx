import type { ReactNode } from "react";
import { won } from "./money";

/**
 * ⭐ 표 정본 (ERP 구조화 배치1, 2026-08-25)
 *
 *   body가 overflow-x:hidden(globals.css)이라 넓은 표는 반드시 자체 스크롤 —
 *   -mx-4 … px-4 로 화면 끝까지 쓰면서 안에서만 옆으로 민다 (receiving/history 문법).
 *   행 JSX는 각 화면이 소유한다 — 셀마다 폼·버튼이 박히는 화면들이라
 *   데이터 주도 columns API는 과잉(설계 결정, 기각됨).
 */
export function TableWrap({
  children,
  isEmpty,
  empty,
  minWidth = 560,
}: {
  children: ReactNode;
  isEmpty?: boolean;
  empty?: string;
  minWidth?: number;
}) {
  if (isEmpty) {
    return (
      <div className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        {empty ?? "표시할 내용이 없습니다"}
      </div>
    );
  }
  return (
    <div className="-mx-4 mt-2 overflow-x-auto px-4">
      <table className="tabular w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

/** 금액 한 칸 — tabular-nums, 음수는 빨강, signed면 양수에 + */
export function Money({ n, signed }: { n: number; signed?: boolean }) {
  const cls = n < 0 ? "text-red-600" : signed && n > 0 ? "text-emerald-700" : "";
  return (
    <span className={`tabular ${cls}`}>
      {signed && n > 0 ? "+" : ""}
      {won(n)}
    </span>
  );
}
