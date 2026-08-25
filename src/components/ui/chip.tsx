import type { ReactNode } from "react";
import Link from "@/lib/link";

/**
 * ⭐ 필터 칩 정본 (디자인 리프레시 배치1) — 활성=검정(브랜드색 남발 방지), 44px 보장.
 */
const chipCls = (active: boolean) =>
  `inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors ${
    active
      ? "bg-slate-900 text-white"
      : "border border-slate-300 bg-white text-slate-600 active:bg-slate-100 lg:hover:bg-slate-50"
  }`;

export function ChipLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={chipCls(active)}>
      {children}
    </Link>
  );
}

export function ChipButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={chipCls(active)}>
      {children}
    </button>
  );
}
