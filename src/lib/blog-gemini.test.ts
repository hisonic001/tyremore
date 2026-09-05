import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { GEMINI_PROMPT, composeForGemini } from "./blog-gemini";

/**
 * 제미나이 지시문은 **앱의 검사기와 같은 자**를 써야 한다 (2026-09-05).
 * 여기서 못 박는 것은 두 가지다:
 *   ① 검사기의 실제 값이 지시문에 들어 있는가 (blog-style.ts 를 고치면 여기가 깨진다)
 *   ② 문서(docs/18)와 코드가 같은 지시문인가 (자가 두 개면 반드시 어긋난다)
 */
describe("제미나이 지시문 — 검사기와 같은 자", () => {
  it("🔴 titleFilter 의 값이 그대로 들어 있다 (32자 · 앞 12자 · 낱말 목록)", () => {
    assert.match(GEMINI_PROMPT, /32 Korean characters or fewer/);
    assert.match(GEMINI_PROMPT, /FIRST 12 CHARACTERS/);
    for (const w of ["속초", "얼라인먼트", "엔진오일", "공기압", "위치 교환", "밸런스", "TPMS", "점검"]) {
      assert.ok(GEMINI_PROMPT.includes(w), `제목 낱말 ${w} 가 빠졌다`);
    }
  });

  it("🔴 styleFilter 의 값이 그대로 들어 있다 (소제목 6~24자 · 평균 45자 · 오늘 정리)", () => {
    assert.match(GEMINI_PROMPT, /6–24 Korean characters/);
    assert.match(GEMINI_PROMPT, /45 characters or below/);
    assert.ok(GEMINI_PROMPT.includes("오늘 정리"));
  });

  it("🔴 금지 상투구 10개가 하나도 빠지지 않았다", () => {
    const cliches = [
      "좋은 시기입니다", "중요합니다", "말씀드리는 편입니다", "하는 것이 좋습니다",
      "잊지 마시기 바랍니다", "도움이 되셨길", "안전 운전 하세요",
      "라고 할 수 있습니다", "필수적입니다", "핵심입니다",
    ];
    for (const c of cliches) assert.ok(GEMINI_PROMPT.includes(c), `상투구 ${c} 가 빠졌다`);
  });

  it("🔴 자리표시자를 지키라는 말이 있다 — 이게 없으면 사진 자리가 사라진다", () => {
    assert.ok(GEMINI_PROMPT.includes("{{사장님_한마디}}"));
    assert.ok(GEMINI_PROMPT.includes("[영상 - 작업 장면]"));
    assert.ok(GEMINI_PROMPT.includes("※ 아래에 매장 지도(장소)를 붙여 주세요"));
  });

  it("결과는 한국어로 내라고 못 박는다 — 영어로 지시하면 영어로 답하려 든다", () => {
    assert.match(GEMINI_PROMPT, /Write ALL of your output in Korean/);
  });
});

describe("composeForGemini — 지시문 + 글을 한 덩이로", () => {
  const d = {
    titles: ["속초 코란도 TPMS 센서 교체", "둘째 제목", "셋째 제목"],
    body: "첫 줄입니다.\n\n[사진 A-00 - 정면]\n\n{{사장님_한마디}}",
    tags: ["속초타이어", "#TPMS", "코란도 스포츠"],
  };

  it("지시문이 앞에 오고 글이 뒤에 온다", () => {
    const out = composeForGemini(d);
    assert.ok(out.startsWith("You are a Korean copy editor"));
    assert.ok(out.indexOf("[본문]") > out.indexOf("THE POST TO EDIT STARTS BELOW"));
  });

  it("🔴 {{사장님_한마디}} 를 그대로 보낸다 — 사장님 육성은 제미나이가 손댈 것이 아니다", () => {
    assert.ok(composeForGemini(d).includes("{{사장님_한마디}}"));
  });

  it("사진 자리표시자가 살아 있다", () => {
    assert.ok(composeForGemini(d).includes("[사진 A-00 - 정면]"));
  });

  it("제목 후보 3개가 번호와 함께 들어간다", () => {
    const out = composeForGemini(d);
    assert.ok(out.includes("1. 속초 코란도 TPMS 센서 교체"));
    assert.ok(out.includes("3. 셋째 제목"));
  });

  it("해시태그는 # 하나 · 공백 없이", () => {
    const out = composeForGemini(d);
    assert.ok(out.includes("#속초타이어 #TPMS #코란도스포츠"));
  });
});

/**
 * 🔴 **문서와 코드가 같은 지시문이어야 한다.** 사장님은 문서를 보고 손으로도 쓰신다 —
 *    앱 단추와 문서가 다른 말을 하면 어느 쪽이 맞는지 알 수 없게 된다.
 */
describe("docs/18 과 코드가 같은 지시문인가", () => {
  it("문서에 실린 지시문이 코드의 GEMINI_PROMPT 와 같다", () => {
    /* 🔴 문서는 윈도 줄바꿈(CRLF)이라 그대로 비교하면 늘 어긋난다 */
    const doc = readFileSync("docs/18-제미나이-검수-프롬프트.md", "utf8").replace(/\r\n/g, "\n");
    const fence = "`".repeat(3);
    const a = doc.indexOf(fence);
    const b = doc.indexOf(fence, a + 3);
    assert.ok(a >= 0 && b > a, "문서에서 지시문 블록을 못 찾았다");
    const inDoc = doc.slice(a + 3, b).trim();
    const wantedTail = "======== THE POST TO EDIT STARTS BELOW ========";
    assert.ok(inDoc.includes(wantedTail));
    /* 문서에는 끝에 붙여넣기 안내 한 줄이 더 있다 — 그 앞까지가 지시문이다 */
    const upto = inDoc.slice(0, inDoc.indexOf(wantedTail) + wantedTail.length).trim();
    assert.equal(upto, GEMINI_PROMPT.replace(/\r\n/g, "\n").trim());
  });
});
