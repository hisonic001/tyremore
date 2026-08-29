import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * 로그인하지 않으면 아무 화면도 못 본다.
 *
 * ⚠️ 배포하면 인터넷에 열린다. 고객 실명·휴대폰 2,593건과 매입가가 들어 있으므로
 *    화면 단에서 가리는 것으로는 부족하다. 요청 자체를 막는다.
 *
 * 미들웨어는 Edge 에서 돌아 `node:crypto` 를 못 쓴다. `session.ts` 는 Web Crypto 만 쓴다.
 */
export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // 설정이 빠진 채로 열리는 것이 가장 위험하다. 통과시키지 않는다.
    return new NextResponse("AUTH_SECRET 이 설정되지 않았습니다", { status: 500 });
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  if (session) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // 로그인 후 원래 보려던 화면으로 돌려보낸다
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /**
     * 로그인 화면과 정적 파일만 열어 둔다.
     * `_next/static`·`_next/image` 는 화면 자산이라 막으면 로그인 화면도 깨진다.
     *
     * `api/cron` 은 Vercel 크론이 부른다 — 로그인 쿠키가 없다. 그 경로는 자기 비밀키
     * (CRON_SECRET) 로 스스로 막는다 (src/app/api/cron/blog-draft/route.ts).
     */
    "/((?!login|api/cron|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
