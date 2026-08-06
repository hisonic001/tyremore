import type { Metadata, Viewport } from "next";
import "./globals.css";
import { HomeButton } from "./home-button";

export const metadata: Metadata = {
  title: "타이어모어",
  description: "재고·상담·견적 통합 시스템",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 장갑 낀 손으로 조작한다. 실수로 확대되면 되돌리기가 번거롭다.
  maximumScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        {/* ⭐ 어느 화면에서든 홈으로 (사장님 요청 2026-08-06) — 홈·로그인·인쇄에선 숨는다 */}
        <HomeButton />
      </body>
    </html>
  );
}
