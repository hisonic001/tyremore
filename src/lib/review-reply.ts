"use server";

/**
 * 플레이스 리뷰 답글 초안 (마케팅 2단계, 2026-08-29 — docs/17)
 *
 * 리뷰를 프로그램이 읽어 오지 않는다 — 스마트플레이스 앱 알림이 무료로 해 준다(3인 리뷰).
 * 사장님이 리뷰를 붙여넣으면 답글 초안만 만든다. 등록은 플레이스 앱에서 직접.
 *
 * 톤 (SEO 전문가): 100자 안팎, 해당 차종·시공을 한 번 언급(진짜 답글이라는 표시),
 * 검색 키워드 끼워 넣기 금지 — 답글은 검색용이 아니라 다음 손님이 읽는 글이다.
 * 별점이 낮으면 변명 없이 사실 확인 + 연락처 안내 한 줄.
 *
 * 🔴 붙여넣은 원문에서 이름·전화로 보이는 글자는 API 로 나가기 전에 가린다.
 */
import { generateJson } from "./ai";
import { hasPerm } from "./auth";

const SYSTEM = `당신은 강원도 속초 타이어 전문점 「타이어모어 속초점」 사장입니다. 네이버 플레이스 리뷰에 다는 답글을 씁니다.
- 80~120자. 존댓말. 담백하게. 이모지는 많아야 하나.
- 리뷰에 나온 차종·작업 내용이 있으면 한 번 그대로 언급합니다 (자동 답글이 아니라는 표시).
- 검색용 키워드("속초 타이어" 같은 것)를 억지로 넣지 않습니다.
- 별점 1~2점: 변명·반박 금지. 불편을 드린 점 사과 → 사실 확인하겠다 → 매장 전화로 연락 부탁 한 줄.
- 별점 3점: 아쉬운 점을 알려 주셔서 고맙다 → 무엇을 고치겠다 한 가지.
- 별점 4~5점: 고맙다 → 리뷰에서 언급한 것 하나 되짚기 → 다음 점검 시기 한 줄(예: 공기압은 한 달에 한 번).
- 손님 이름을 부르지 않습니다. 개인정보를 되풀이하지 않습니다.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: { reply: { type: "string" } },
};

function mask(text: string): string {
  return text
    .replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[전화]")
    .replace(/\d{2,3}\s?[가-힣]\s?\d{4}/g, "[차량번호]")
    .replace(/([가-힣]{2,4})\s?(님|고객님|사장님)/g, "[이름]$2");
}

export async function draftReply(input: { rating: number; text: string }): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  if (!(await hasPerm("marketing"))) return { ok: false, error: "마케팅 권한이 없습니다" };
  const text = mask(input.text.trim()).slice(0, 1500);
  if (text.length < 5) return { ok: false, error: "리뷰 내용을 붙여넣어 주세요" };
  const rating = Math.min(5, Math.max(1, Math.round(input.rating || 5)));
  try {
    const { data } = await generateJson<{ reply: string }>({
      system: SYSTEM,
      user: `별점: ${rating}점\n리뷰:\n${text}\n\n답글을 써 주세요.`,
      schema: SCHEMA,
      effort: "low",
      maxTokens: 800,
    });
    return { ok: true, reply: data.reply.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
