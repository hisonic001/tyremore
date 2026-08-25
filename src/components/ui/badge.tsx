import type { ReactNode } from "react";

/**
 * ⭐ 배지 정본 (디자인 리프레시 배치1) — 상태와 카테고리를 「형태」로 분리
 *
 *   status   = rounded-full 채움형 (성공·경고·오류·정보·중립) — "지금 어떤 상태인가"
 *   category = rounded-md 테두리형 (계절·runflat·OE …) — "어떤 종류인가"
 *   색이 겹쳐도(겨울 sky ↔ 추천 sky) 형태가 달라 혼동이 없다.
 */
const STATUS_TONE = {
  success: "bg-brand-50 text-brand-700",
  warn: "bg-amber-100 text-amber-800",
  error: "bg-red-50 text-red-700",
  info: "bg-sky-100 text-sky-800",
  neutral: "bg-slate-100 text-slate-600",
  /** 할 일 수 강조 — 브랜드 노랑(검정 글자 전용) */
  accent: "bg-accent-400 text-slate-900",
} as const;

export function StatusPill({ tone = "neutral", children }: { tone?: keyof typeof STATUS_TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[tone]}`}>
      {children}
    </span>
  );
}

/** 카테고리 배지 — 테두리형. colorClass 는 글자색만 (예: "text-sky-700") */
export function CategoryTag({ colorClass = "text-slate-600", children }: { colorClass?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-current/30 bg-white px-1.5 py-0.5 text-xs font-medium ${colorClass}`}>
      {children}
    </span>
  );
}
