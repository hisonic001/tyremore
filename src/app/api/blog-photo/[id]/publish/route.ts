import { NextResponse } from "next/server";
import { hasPerm } from "@/lib/auth";
import { getPublish } from "@/lib/blog-photo";

/**
 * ⭐ **발행용 사진 한 장** (1280px) — 끌어다 놓기용 (2026-09-05)
 *
 * 🔴 왜 미리보기(`thumb`)와 따로 두나: 화면 「사진 순서」의 그림을 끌어 네이버 글쓰기에
 *    붙이면 **그림 파일 자체**가 넘어간다. 목록용 160px 을 끌면 160px 이 올라간다.
 *    사장님이 「화질이 너무 안 좋다」고 하신 것이 바로 이것이다.
 *
 * 🔴 없으면 **404**를 낸다. 미리보기로 몰래 갈아치우면 안 된다 —
 *    「고화질인 줄 알고 올렸는데 아니었다」가 가장 나쁜 결과다. 화면이 404를 보고
 *    「고화질로 준비」 단추를 대신 보여 준다.
 *
 * 🔴 사장님 계정만. 로그인 미들웨어가 이미 막지만 여기서도 한 번 더 본다.
 */
export const dynamic = "force-dynamic";

/** 네이버에 올라간 파일 이름이 `publish` 가 되지 않게 — 원본 이름을 붙여 준다 */
function asciiName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${base || "photo"}.jpg`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("marketing"))) return new NextResponse("no", { status: 403 });
  const { id } = await ctx.params;
  const found = await getPublish(Number(id));
  if (!found) return new NextResponse("not found", { status: 404 });

  return new NextResponse(new Uint8Array(Buffer.from(found.b64, "base64")), {
    headers: {
      "content-type": "image/jpeg",
      "content-disposition": `inline; filename="${asciiName(found.fileName)}"`,
      // 한 번 구운 사진은 바뀌지 않는다 — 받은 뒤로는 캐시에서 꺼낸다
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
