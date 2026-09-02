"use client";

import Link from "@/lib/link";
import { usePathname } from "next/navigation";
import { House, Plus, Settings, Wallet, Wrench } from "lucide-react";

/**
 * ⭐ 전역 내비 (디자인 리프레시 배치1, 사장님 승인 2026-08-25 — "상용 서비스 수준")
 *
 *   모바일 = 하단 탭바 5개 (토스 문법). PC(lg) = 상단 고정 헤더 + 같은 5항목.
 *   작업 흐름 화면(/sale·/print·/login)에서는 숨긴다 — 플로우 진입 시 탭 제거.
 *   /sale 은 하단 결제 바가 있어 기존 HomeButton(FAB)이 그 화면 전용으로 남는다.
 */
const TABS = [
  { href: "/", label: "홈", Icon: House, match: (p: string) => p === "/" || p.startsWith("/product") || p.startsWith("/stock") },
  {
    href: "/sales",
    label: "정비 내역",
    Icon: Wrench,
    match: (p: string) => p.startsWith("/sales") || p.startsWith("/receivables") || p.startsWith("/vehicle"),
  },
  { href: "/sale", label: "판매", Icon: Plus, match: (p: string) => p === "/sale" },
  {
    href: "/finance",
    label: "돈 관리",
    Icon: Wallet,
    match: (p: string) => p.startsWith("/finance") || p.startsWith("/reports"),
  },
  {
    href: "/settings",
    label: "설정",
    Icon: Settings,
    match: (p: string) => p.startsWith("/settings") || p.startsWith("/receiving") || p.startsWith("/mars") || p.startsWith("/status"),
  },
];

export function AppNav({ hide = [] }: { hide?: string[] }) {
  const path = usePathname();
  const tabs = TABS.filter((t) => !hide.includes(t.href));
  if (path === "/sale" || path === "/login" || path.startsWith("/print/")) return null;

  return (
    <>
      {/* PC 상단 헤더 — 고정 + 본문 밀어내는 스페이서 */}
      <div className="hidden h-12 lg:block" aria-hidden />
      <header className="fixed inset-x-0 top-0 z-40 hidden border-b border-slate-100 bg-white/85 backdrop-blur lg:block print:hidden">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-extrabold tracking-tight">
            타이어<span className="text-brand-500">모어</span>
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map(({ href, label, Icon, match }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-slate-100 ${
                  match(path) ? "text-brand-700" : "text-slate-600"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* 모바일 하단 탭바 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden print:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map(({ href, label, Icon, match }) => {
            const on = match(path);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-slate-100 ${
                  on ? "text-brand-600" : "text-slate-400"
                }`}
              >
                <Icon className="size-5" strokeWidth={on ? 2.4 : 2} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
