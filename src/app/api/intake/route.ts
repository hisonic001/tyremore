import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleIntake, type IntakeInput } from "@/lib/intake";

/**
 * ⭐ 자동 수집 받는 문 (2026-11-17, D-41) — 처리는 lib/intake.ts
 *
 *   로그인이 없는 보내는 쪽(폰 알림 전달 앱·구글 스크립트)이 부른다 → 미들웨어 예외 경로.
 *   🔴 대신 비밀키(INTAKE_TOKEN)가 없거나 틀리면 아무것도 하지 않는다. 비밀키가 설정되지 않았으면 문을 닫는다.
 *      키는 헤더 「Authorization: Bearer …」 또는 주소 ?key=… (알림 앱이 헤더를 못 넣는 경우).
 *   🔴 이 문은 **넣기만** 한다 — 자료를 내보내는 응답은 없다(결과 한 줄만).
 *
 *   본문
 *     JSON  { type: "bank-alert", text } | { type: "mail-file", … } | { type: "mail-note", … }
 *     글자  (Content-Type: text/plain) → 은행 알림 글자 그대로 (?type=bank-alert 생략 가능)
 *           알림 앱은 줄바꿈 섞인 글자를 JSON 에 넣다가 깨지기 쉬워서 글자 그대로도 받는다.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.INTAKE_TOKEN ?? "";
  if (secret.length < 24) return false;
  const url = new URL(req.url);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  if (!authorized(req)) return bad("권한 없음", 401);

  let input: IntakeInput;
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("application/json")) {
      const j = (await req.json()) as Record<string, unknown>;
      const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : null);
      /* 지난 메일 일괄 검토(구글 스크립트 backfill)는 「review」 — 해석만 하고 장부에 넣지 않는다 */
      const mode = j.mode === "review" ? ("review" as const) : ("apply" as const);
      if (j.type === "bank-alert") {
        // 알림 앱마다 칸 이름이 다르다 — 가장 긴 글자(펼친 내용)를 쓴다
        const text = [s("bigText"), s("text"), s("body")].filter(Boolean).sort((x, y) => y!.length - x!.length)[0];
        if (!text) return bad("text 가 비었습니다");
        input = { type: "bank-alert", text: `${s("title") ?? ""}\n${text}`, app: s("app"), title: s("title") };
      } else if (j.type === "mail-file") {
        const messageId = s("messageId");
        const fileName = s("fileName");
        const base64 = s("base64");
        if (!messageId || !fileName || !base64) return bad("messageId·fileName·base64 가 필요합니다");
        input = { type: "mail-file", messageId, index: Number(j.index ?? 0), sender: s("sender"), subject: s("subject"), fileName, mime: s("mime"), base64, mode };
      } else if (j.type === "mail-note") {
        const messageId = s("messageId");
        const body = s("body");
        if (!messageId || !body) return bad("messageId·body 가 필요합니다");
        input = { type: "mail-note", messageId, sender: s("sender"), subject: s("subject"), body, mode };
      } else {
        return bad("type 을 모릅니다");
      }
    } else {
      const text = (await req.text()).trim();
      if (!text) return bad("본문이 비었습니다");
      input = { type: "bank-alert", text, app: new URL(req.url).searchParams.get("app") };
    }
  } catch {
    return bad("본문을 읽지 못했습니다");
  }

  const r = await handleIntake(input);
  return NextResponse.json({ ok: r.status !== "오류", status: r.status, result: r.result });
}
