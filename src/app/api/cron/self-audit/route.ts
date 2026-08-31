import { NextResponse } from "next/server";
import { runAndSaveAudit } from "@/lib/self-audit";

/**
 * ⭐ 매일 자동 감사 (Vercel Cron 07:30 KST = 22:30 UTC — vercel.json crons)
 *   비밀키(CRON_SECRET)가 설정돼 있으면 Bearer 로 요구하고, 없으면 Vercel cron 헤더만 본다.
 *   감사는 읽기+기록뿐이라 잘못 호출돼도 자료가 바뀌지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const fromVercel = req.headers.get("x-vercel-cron") !== null || (req.headers.get("user-agent") ?? "").includes("vercel-cron");
  if (secret ? auth !== `Bearer ${secret}` : !fromVercel) {
    return NextResponse.json({ ok: false, error: "권한 없음" }, { status: 401 });
  }
  const r = await runAndSaveAudit();
  return NextResponse.json({ ok: true, items: r.items.length });
}
