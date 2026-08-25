import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import Link from "@/lib/link";

/**
 * ⭐ 버튼 정본 (디자인 리프레시 배치1, 사장님 승인 2026-08-25)
 *
 *   primary = 브랜드 초록 #007a36(brand-600 — 흰 글자 AA 대비) — "누르면 일이 일어나는 곳".
 *   활성 탭·칩은 계속 검정(slate-900) — 초록 남발 방지.
 *   size 는 둘 다 44px 이상(장갑 낀 손). pending 이면 스피너 + 잠금.
 */
const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-semibold select-none " +
  "transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
const SIZE = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-[3.25rem] w-full px-5 text-lg",
} as const;
const VARIANT = {
  primary: "bg-brand-600 text-white lg:hover:bg-brand-700 active:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-900 lg:hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 lg:hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-red-600 text-white lg:hover:bg-red-700 active:bg-red-700",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** 진행 중 — 스피너를 보여주고 잠근다 */
  pending?: boolean;
}

export function Button({ variant = "primary", size = "md", pending, children, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={pending || rest.disabled}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className ?? ""}`}
    >
      {pending && <LoaderCircle className="size-5 animate-spin" />}
      {children}
    </button>
  );
}

/** 링크인데 버튼처럼 보여야 할 때 — 반드시 lib/link (prefetch=false) */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
  className,
}: {
  href: string;
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${className ?? ""}`}>
      {children}
    </Link>
  );
}
