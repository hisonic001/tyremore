"use client";

/**
 * ⭐ 「☑ 다음부터 자동으로」 (개편 4단계, 2026-09-12 — 사장님 결정 7, **기본 켜짐**)
 *
 *   맞추기 단추 옆에 붙는 작은 체크칸. 켜 두면 이 상대를 앱이 기억해서, 다음 달에 같은 상대가
 *   오면 **바로 붙인다**(금액이 안 맞으면 후보로만). 이번 건만 맞추고 기억은 시키고 싶지 않을 때 끈다.
 *   배운 규칙은 설정 → 「자동 규칙」에서 보고 끌 수 있다.
 *
 *   🔴 글자는 fin-words.ts 에서 — 화면에 직접 박지 않는다.
 */
import { W } from "@/lib/fin-words";

export function LearnCheck({
  value,
  onChange,
  disabled,
  label = W.learnNext,
  className = "",
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** 일괄 자리에서는 「이번 일괄은 규칙 학습 안 함」처럼 뜻이 뒤집힌 글자를 쓴다 */
  label?: string;
  className?: string;
}) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-1 text-xs text-slate-500 ${className}`}>
      <input
        type="checkbox"
        className="size-3.5 accent-brand-600"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
