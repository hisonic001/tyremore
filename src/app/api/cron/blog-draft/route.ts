import { NextResponse } from "next/server";
import { runNightly } from "@/lib/blog-draft";

/**
 * 매일 21:00 KST (vercel.json crons: "0 12 * * *" UTC) — 그날 시공에서 블로그 초안을 만들어 둔다.
 *
 * 로그인 쿠키가 없는 요청이라 미들웨어가 이 경로를 비켜 준다. 대신 Vercel 이 실어 보내는
 * `Authorization: Bearer <CRON_SECRET>` 로 우리 크론인지 확인한다 — 아니면 아무것도 안 한다.
 *
 * 초안 하나에 30~60초가 걸린다. 3건이면 3분 — 함수 시간 제한을 넉넉히 둔다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET 이 설정되지 않았습니다" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { day, results } = await runNightly({ limit: 3 });
    return NextResponse.json({
      day,
      made: results.filter((r) => r.result?.ok).length,
      results: results.map((r) => ({ quoteNo: r.quoteNo, ok: r.result?.ok ?? null, error: r.result && !r.result.ok ? r.result.error : null })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
