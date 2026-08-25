import type { ReactNode } from "react";

/**
 * ⭐ 빈 상태 정본 (디자인 리프레시 배치1) — 이모지 공식 잔류 허용처.
 */
export function EmptyState({
  emoji,
  title,
  hint,
  action,
}: {
  emoji?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-card border border-dashed border-slate-300 bg-white p-8 text-center">
      {emoji && <p className="text-3xl">{emoji}</p>}
      <p className="mt-2 text-[15px] font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-[13px] leading-snug text-slate-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
