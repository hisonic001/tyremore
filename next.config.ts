import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * ⚠️ 개발과 운영 빌드의 산출물 폴더를 분리한다.
   *
   * 같은 `.next`를 공유하면 `next build` 뒤에 `next dev`를 띄웠을 때 청크가 섞여
   * 화면이 통째로 깨진다. 실제로 그렇게 됐다 (2026-08-01):
   *   · CSS가 안 붙음 (디자인 사라짐)
   *   · 클라이언트 JS가 죽음 (필터 버튼이 안 눌림)
   *   · "Cannot find module './vendor-chunks/drizzle-orm.js'"
   * 증상이 셋이라 원인도 셋인 것처럼 보이지만 하나다.
   *
   * next dev = development, next build/start = production 이므로 이걸로 갈린다.
   */
  distDir: process.env.NODE_ENV === "production" ? ".next-prod" : ".next",

  // D-06 / D-11: 특정 클라우드에 종속되지 않게 표준 Node.js 서버로 빌드한다.
  // Vercel에서도 동작하고, 자체 서버에서는 standalone 서버로 뜬다.
  output: "standalone",

  // 매장 태블릿은 공용이다. 캐시된 화면이 남으면 앞 손님 정보가 보인다.
  poweredByHeader: false,

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
