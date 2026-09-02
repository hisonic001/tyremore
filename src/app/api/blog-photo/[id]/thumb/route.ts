import { NextResponse } from "next/server";
import { hasPerm } from "@/lib/auth";
import { getThumb } from "@/lib/blog-photo";

/**
 * ⭐ 사진 미리보기 한 장 (C단계, 2026-09-02)
 *
 * 🔴 왜 라우트로 따로 내려주나: 미리보기를 화면 데이터에 실으면 404장 = 2.3MB 가
 *    한 방에 실려 폰에서 몇 초가 걸린다. 여기로 나누면 브라우저가 보이는 것만
 *    게으르게 받고, 한 번 받은 뒤로는 캐시에서 꺼내 요청이 0건이 된다.
 *
 * 🔴 사장님 계정만. 로그인 미들웨어가 이미 막지만 여기서도 한 번 더 본다.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("marketing"))) return new NextResponse("no", { status: 403 });
  const { id } = await ctx.params;
  const thumb = await getThumb(Number(id));
  if (!thumb) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(Buffer.from(thumb, "base64")), {
    headers: {
      "content-type": "image/jpeg",
      // 미리보기는 바뀌지 않는다 — 한 번 받으면 다시 안 받게
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
