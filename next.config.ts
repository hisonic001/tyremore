import type { NextConfig } from "next";

/** Vercel 빌드인가 — 산출물 폴더와 output 방식이 갈린다 */
const isVercel = !!process.env.VERCEL;

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
  distDir: isVercel ? ".next" : process.env.NODE_ENV === "production" ? ".next-prod" : ".next",

  /**
   * D-06 / D-11: 특정 클라우드에 종속되지 않게 표준 Node.js 서버로 빌드한다.
   * 자체 서버로 옮길 때 standalone 산출물을 그대로 쓴다.
   * ⚠️ Vercel 은 자체 빌드 방식을 쓰므로 거기서는 끈다 — 켜 두면 산출물이 어긋난다.
   */
  output: isVercel ? undefined : "standalone",

  // 매장 태블릿은 공용이다. 캐시된 화면이 남으면 앞 손님 정보가 보인다.
  poweredByHeader: false,

  /**
   * ⚠️ 인보이스 PDF 를 읽으려면 pdf.js 의 CMap 데이터가 함께 배포돼야 한다.
   *    없으면 한글 CID 폰트 문서(콘티넨탈)에서 글자가 0개로 나온다.
   *    Next.js 는 실제로 import 된 코드만 챙기므로 데이터 파일은 따로 지정해야 한다.
   */
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
