import type { ReactNode } from "react";

/**
 * ⭐ 섹션 카드 정본 (ERP 구조화 배치1, 2026-08-25) — 현행 카드 문법의 이름 붙이기.
 *   primary=강조(손익 등) · suggest=추천/제안 · official=정본(세금계산서 기준) ·
 *   warn=주의 · empty=빈 상태. 시각 변화 없음 — 문법 통일이 목적.
 */
const TONES = {
  default: "border border-slate-200 bg-white",
  primary: "border-2 border-slate-800 bg-white",
  suggest: "border border-sky-300 bg-sky-50",
  official: "border-2 border-emerald-700 bg-white",
  warn: "border border-amber-300 bg-amber-50",
  empty: "border border-dashed border-slate-300 bg-white text-center text-sm text-slate-500",
} as const;

export function SectionCard({
  tone = "default",
  title,
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`mt-4 rounded-card p-4 ${TONES[tone]} ${className ?? ""}`}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
