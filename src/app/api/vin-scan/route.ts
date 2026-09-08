import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createVinScan, MAX_BYTES } from "@/lib/vin-scan-core";

export const dynamic = "force-dynamic";

/**
 * ⭐ 사진 읽기 업로드 경로 (2026-09-08)
 *
 * 🔴 왜 서버 액션이 아닌가: 액션 인자 해독기가 총량을 100만 자로 하드코딩
 *    제한한다(「Maximum array nesting exceeded」 실사고, digest 312436354).
 *    2000px 사진의 base64 는 그걸 넘기 일쑤다 — 여기는 **이진 그대로** 받아
 *    부풀림도 없다. 판정은 vin-scan-core 한 곳(액션과 같은 정본).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "로그인이 필요합니다" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "사진을 받지 못했습니다 — 다시 시도해 주세요" }, { status: 400 });
  }
  const file = form.get("file");
  const mode = form.get("mode") === "판매등록" ? ("판매등록" as const) : ("제원" as const);
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "사진 파일이 없습니다" }, { status: 400 });
  }
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
    return NextResponse.json({ ok: false, error: "사진 파일만 올릴 수 있습니다" }, { status: 400 });
  }
  // dataURL(+33%)로 바꿔도 코어의 4MB 검사 안이어야 한다 — 이진 기준으로 미리 자른다
  if (file.size > (MAX_BYTES * 3) / 4 - 1024) {
    return NextResponse.json({ ok: false, error: "사진이 너무 큽니다 — 다시 찍어 주세요" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type.toLowerCase()};base64,${buf.toString("base64")}`;
  const r = await createVinScan(dataUrl, mode, session.uid ?? null);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
