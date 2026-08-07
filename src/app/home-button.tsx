"use client";

import Link from "@/lib/link";
import { usePathname } from "next/navigation";

/**
 * ⭐ 어느 화면에서든 홈으로 (사장님 요청 2026-08-06)
 *
 *   "어느 화면에서든 홈으로 돌아가는 버튼 하나 추가."
 *
 * 우하단에 떠 있는 집 버튼. 화면 위쪽 「← 검색으로」 링크는 스크롤하면 사라지지만
 * 이 버튼은 늘 그 자리에 있다.
 *   · 홈·로그인에서는 필요 없고, 인쇄 화면에서는 종이에 찍히면 안 되므로 뺀다
 *   · /sale 은 아래에 합계 막대가 붙어 있어 그 위로 올린다
 */
export function HomeButton() {
  const path = usePathname();
  if (path === "/" || path === "/login" || path.startsWith("/print/")) return null;

  return (
    <Link
      href="/"
      aria-label="홈으로"
      className={`fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full
                  bg-slate-900 text-white shadow-lg active:bg-slate-700 print:hidden
                  ${path === "/sale" ? "bottom-24" : "bottom-5"}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
      </svg>
    </Link>
  );
}
