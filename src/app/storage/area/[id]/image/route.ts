import { hasPerm } from "@/lib/auth";
import { areaImage } from "@/lib/tire-storage-data";

export const dynamic = "force-dynamic";

/** ⭐ 구역 도면 배경 사진 (2026-11-18) — 데이터 URL 을 그림으로 내보낸다. ?v= 가 바뀌면 새로 받는다 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasPerm("sale"))) return new Response("권한 없음", { status: 403 });
  const { id } = await params;
  const url = await areaImage(Number(id));
  const m = url ? /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(url) : null;
  if (!m) return new Response("그림 없음", { status: 404 });
  return new Response(new Uint8Array(Buffer.from(m[2], "base64")), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
