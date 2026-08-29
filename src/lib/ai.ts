/**
 * AI 어댑터 (마케팅 1단계, 2026-08-29 — docs/17)
 *
 * 블로그 초안·리뷰 답글이 여기 한 곳을 통해 모델을 부른다.
 * 지금은 클로드 한 벌이다 — 3인 리뷰에서 「두 벌 초안은 짐」이라 제미나이는 화면에서 뺐다.
 * 문체가 마음에 안 들면 이 파일의 provider 하나만 바꾼다.
 *
 * 🔴 여기로 나가는 것은 **시공 사실(차종·규격·본수)과 붙여넣은 글자**뿐이다.
 *    번호판·이름·전화·사진은 이 함수에 오기 전에 이미 걸러져야 한다 (blog-draft.ts privacyFilter).
 *    API 서버는 국외라 개인정보가 섞이면 국외이전이 된다.
 */
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = "claude-opus-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 없습니다 — .env.local 과 Vercel 환경변수에 넣어 주세요 (docs/17)");
  }
  return (_client ??= new Anthropic({ maxRetries: 2, timeout: 4 * 60_000 }));
}

/** 모델이 JSON 한 덩어리로 답하게 하고 그대로 파싱한다 */
export async function generateJson<T>(opts: {
  system: string;
  user: string;
  /** JSON Schema — 모델 출력이 이 모양으로 고정된다 */
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<{ data: T; model: string }> {
  const res = await client().messages.create({
    model: AI_MODEL,
    max_tokens: opts.maxTokens ?? 6000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: {
      effort: opts.effort ?? "medium",
      format: { type: "json_schema", schema: opts.schema },
    },
  });

  if (res.stop_reason === "refusal") {
    throw new Error("모델이 이 요청을 거절했습니다 — 지시문에 문제가 있는지 확인이 필요합니다");
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("답이 잘렸습니다 (max_tokens) — 본문 길이 제한을 확인해 주세요");
  }
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return { data: JSON.parse(text) as T, model: res.model };
  } catch {
    throw new Error(`모델 답을 JSON 으로 읽지 못했습니다: ${text.slice(0, 120)}`);
  }
}
