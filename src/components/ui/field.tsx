import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * ⭐ 입력 정본 (디자인 리프레시 배치1) — 로그인 FIELD 상수의 승격.
 *   포커스는 전역 focus-visible 링 + focus:border-brand-500.
 */
const INPUT =
  "w-full rounded-control border border-slate-300 bg-white px-4 py-3 text-base " +
  "placeholder:text-slate-400 focus:border-brand-500 focus:outline-none disabled:bg-slate-50";

export function Field({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[13px] font-medium text-slate-600">{label}</span>}
      <input {...rest} className={`${INPUT} ${error ? "border-red-400" : ""} ${className ?? ""}`} />
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function SelectField({
  label,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[13px] font-medium text-slate-600">{label}</span>}
      <select {...rest} className={`${INPUT} ${className ?? ""}`}>
        {children}
      </select>
    </label>
  );
}

export function TextareaField({
  label,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[13px] font-medium text-slate-600">{label}</span>}
      <textarea {...rest} className={`${INPUT} ${className ?? ""}`} />
    </label>
  );
}
