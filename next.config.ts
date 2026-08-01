import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // D-06 / D-11: 특정 클라우드에 종속되지 않게 표준 Node.js 서버로 빌드한다.
  // Vercel에서도 동작하고, 자체 서버에서는 `node .next/standalone/server.js`로 뜬다.
  output: "standalone",

  // 매장 태블릿은 공용이다. 캐시된 화면이 남으면 앞 손님 정보가 보인다.
  poweredByHeader: false,

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
