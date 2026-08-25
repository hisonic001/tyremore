import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { HomeButton } from "./home-button";
import { AppNav } from "@/components/ui/app-nav";

/* ⭐ 배치1 — Pretendard 실제 로딩 (그동안 이름만 있고 맑은고딕 폴백이었다) */
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "타이어모어",
  description: "재고·상담·견적 통합 시스템",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 장갑 낀 손으로 조작한다. 실수로 확대되면 되돌리기가 번거롭다.
  maximumScale: 1,
  themeColor: "#009944", // 브라우저 상단바 = 간판 초록
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>
        {/* ⭐ 배치1 — 전역 내비: 모바일 하단 탭바 + PC 상단 헤더 (작업 흐름 화면에선 스스로 숨음) */}
        <AppNav />
        {children}
        {/* ⭐ 어느 화면에서든 홈으로 (사장님 요청 2026-08-06) — 홈·로그인·인쇄에선 숨는다 */}
        <HomeButton />
      </body>
    </html>
  );
}
