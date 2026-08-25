"use client";

import Link from "@/lib/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";

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
  // 배치1: 전역 탭바(AppNav) 도입 — 이 FAB는 탭바가 숨는 /sale(하단 결제 바 화면) 전용
  if (path !== "/sale") return null;

  return (
    <Link
      href="/"
      aria-label="홈으로"
      className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full
                  bg-brand-600 text-white shadow-float active:bg-brand-700 print:hidden"
    >
      <House className="h-6 w-6" />
    </Link>
  );
}
