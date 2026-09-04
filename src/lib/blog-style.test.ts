import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSystem, countSubheads, styleFilter, titleFilter } from "./blog-style";

/**
 * 「AI 가 쓴 티」 검사 — 사장님 지적(2026-09-02)에서 나온 규칙들.
 * 실제로 나왔던 나쁜 글과 사장님이 발행하신 좋은 글을 각각 표본으로 쓴다.
 */

/**
 * 🔴 **새 뼈대를 갖춘 글** (2026-09-04 개정). 예전 표본은 소제목이 1개뿐이고
 *    「오늘 정리」가 없어서, 새 규칙에서는 통과하지 않는 것이 맞다 —
 *    그게 이번 개정으로 고치려던 바로 그 결함이다.
 */
const GOOD = `기아 쏘렌토 하이브리드로 방문하신
고객님, 이번이 두 번째 방문이었습니다.

주행거리는 126,726km였고, 이번 방문
목적은 얼라인먼트 조정이었습니다.

기존 타이어 마모 분석

저희 타이어모어 속초점은 단순히
타이어를 탈부착하고 끝내지 않습니다.

교체 시 탈거한 기존 타이어의
마모 패턴과 형상을 꼼꼼하게 분석해
어디서 문제가 시작됐는지 파악합니다.

헌터 장비 정밀 측정

리프트에 올려 네 바퀴를 모두 측정했습니다.
전륜 캠버가 좌우로 벌어져 있었습니다.

캠버와 토우 교정

규정값 안으로 넣고 다시 측정했습니다.
좌우 편차를 0.1mm까지 맞췄습니다.

시험 주행과 마무리

핸들 쏠림이 없는지 확인하고
공기압을 다시 맞춘 뒤 출고했습니다.

오늘 정리

얼라인먼트 조정 · 전륜 캠버 교정
다음 점검은 5,000km 뒤를 권합니다.

많이 물어보시는 질문

타이어만 갈면 안 되나요?
편마모가 있으면 원인을 먼저 봐야 합니다.

{{사장님_한마디}}

타이어모어 속초점
※ 아래에 매장 지도(장소)를 붙여 주세요`;

describe("styleFilter — 「AI 가 쓴 티」 잡기", () => {
  it("사장님 실제 글은 통과한다", () => {
    assert.equal(styleFilter(GOOD), null);
  });

  it("마크다운 소제목은 걸린다 — 네이버는 '#' 을 글자로 찍는다", () => {
    const r = styleFilter(`${GOOD}\n\n## 마무리\n내용입니다.`);
    assert.ok(r);
    assert.match(r.reason, /마크다운/);
  });

  it("표는 걸린다", () => {
    const r = styleFilter(`${GOOD}\n\n| 항목 | 내용 |\n| --- | --- |`);
    assert.ok(r);
    assert.match(r.reason, /표/);
  });

  it("체크리스트·불릿은 걸린다", () => {
    const r = styleFilter(`${GOOD}\n\n- [ ] 마모 한계선 확인\n- [ ] 공기압 확인`);
    assert.ok(r);
    assert.match(r.reason, /체크리스트|불릿/);
  });

  it("뭉갠 주행거리는 걸린다 — 정확한 km 를 주는데 뭉개면 안 된다", () => {
    const r = styleFilter(`주행 9만km대 말리부에\n타이어를 넣었습니다.\n\n${GOOD}`);
    assert.ok(r);
    assert.match(r.reason, /주행거리/);
  });

  it("계절 이야기로 시작하면 걸린다 — 실제로 나왔던 첫 문장", () => {
    const bad =
      "여름이 끝나가는 9월 초는 타이어를 한 번 들여다보시기 좋은 시기입니다.\n무더위에 달궈진 아스팔트를 달린 뒤라 고무가 지쳐 있습니다.";
    const r = styleFilter(bad);
    assert.ok(r);
    assert.match(r.reason, /계절|날씨/);
  });

  it("줄이 길면 걸린다 — 폰에서 읽는 글이다", () => {
    const long = Array.from(
      { length: 10 },
      () => "타이어는 온도에 민감합니다. 여름 내내 뜨거운 노면을 달리면 마모가 평소보다 빨리 진행되고 옆면에 잔금이 생기기도 합니다.",
    ).join("\n");
    const r = styleFilter(long);
    assert.ok(r);
    assert.match(r.reason, /줄이 너무 깁니다/);
  });

  it("상투구가 하나면 넘어가고 둘이면 걸린다", () => {
    assert.equal(styleFilter(`${GOOD}\n\n점검이 중요합니다.`), null);
    const r = styleFilter(`${GOOD}\n\n점검이 중요합니다.\n미리 보시는 게 좋은 시기입니다.`);
    assert.ok(r);
    assert.match(r.reason, /상투/);
  });

  it("고칠 말(fix)이 늘 함께 온다 — 다음 시도 지시문에 붙는다", () => {
    const r = styleFilter(`${GOOD}\n\n## 소제목`);
    assert.ok(r);
    assert.ok(r.fix.length > 10);
  });
});

describe("buildSystem — 문체는 예시로, 뼈대는 말로", () => {
  it("표본이 있으면 지시문에 그대로 들어간다", () => {
    const s = buildSystem([GOOD]);
    assert.ok(s.includes("이 블로그에 실제로 실린 글"));
    assert.ok(s.includes("126,726km"));
  });

  it("🔴 「예시에는 소제목이 거의 없지만 당신은 넣어야 합니다」가 반드시 들어간다", () => {
    /* 이 한 줄이 없으면 모델이 예시를 따라 소제목 없는 글을 또 낸다 */
    const s = buildSystem([GOOD]);
    assert.match(s, /소제목이 거의 없지만/);
    assert.match(s, /소제목 4~6개/);
    assert.match(s, /오늘 정리/);
  });

  it("표본이 없어도 규칙만으로 지시문이 만들어진다 (Vercel 쪽 대비)", () => {
    const s = buildSystem([]);
    assert.ok(!s.includes("이 블로그에 실제로 실린 글"));
    assert.ok(s.includes("마크다운"));
  });

  it("너무 짧은 표본은 본보기로 안 쓴다", () => {
    const s = buildSystem(["짧은 글"]);
    assert.ok(!s.includes("이 블로그에 실제로 실린 글"));
  });

  it("표본은 두 편까지만 — 지시문이 무거워지면 본문 쓸 여력이 준다", () => {
    const s = buildSystem([GOOD, GOOD, GOOD]);
    assert.equal(s.split("━━━ 이 블로그 글").length - 1, 2);
  });
});

/**
 * 🔴 아래 제목들은 2026-09-04 에 **실제로 재 본 것**이다.
 *    발행 글 3편이 45·61·40자, 앱이 만든 것이 38~58자 — 전부 모바일 35자에서 잘렸다.
 *    제목에는 검사가 하나도 없어서 계절 제목까지 그대로 나왔다.
 */
describe("titleFilter — 제목이 가장 큰 구멍이었다", () => {
  const OK = ["속초 쏘렌토 얼라인먼트 재방문", "속초 타이어 편마모 원인 찾기", "쏘렌토 하이브리드 휠얼라인먼트 속초"];

  it("좋은 제목 세 개는 통과한다", () => {
    assert.equal(titleFilter(OK), null);
  });

  it("🔴 실제로 나왔던 61자 제목은 걸린다 — 폰에서 절반이 안 보인다", () => {
    const r = titleFilter([
      "타이어 하나 터졌는데 두 개 바꾼 이유 — 속초 벤츠 GLS 피렐리 스콜피온 교체 + 밸런스 + TPMS 후기",
      ...OK.slice(1),
    ]);
    assert.ok(r);
    assert.match(r.reason, /제목이 깁니다/);
    assert.match(r.reason, /61자/);
  });

  it("🔴 앞부분에 찾는 말이 없으면 걸린다 — 실제로 나왔던 제목", () => {
    /* `테슬라는 그냥 들면 안 됩니다 — 속초 모델3…` : 앞 12자에 속초도 작업명도 없다 */
    const r = titleFilter(["테슬라는 그냥 들면 안 됩니다", ...OK.slice(1)]);
    assert.ok(r);
    assert.match(r.reason, /앞부분에 찾는 말이 없습니다/);
  });

  it("🔴 계절로 여는 제목은 걸린다 — 앱이 실제로 만들던 것", () => {
    for (const bad of ["여름 끝물 9월, 속초 타이어 교체", "첫눈 오고 나서 속초 타이어 장착"]) {
      const r = titleFilter([bad, ...OK.slice(1)]);
      assert.ok(r, bad);
      assert.match(r.reason, /계절/);
    }
  });

  it("세 개가 겹치면 고를 이유가 없다", () => {
    const r = titleFilter([OK[0], OK[0], OK[1]]);
    assert.ok(r);
    assert.match(r.reason, /겹칩니다/);
  });

  it("제목이 없으면 걸린다", () => {
    assert.ok(titleFilter([]));
  });
});

describe("소제목 세기 — 훑을 수 있게 만드는 장치", () => {
  it("앞뒤 빈 줄 + 짧고 + 서술어 없이 끝나는 줄만 센다", () => {
    assert.ok(countSubheads(GOOD) >= 4);
  });

  it("🔴 본문 문장은 소제목으로 안 센다 — 예전 글이 여기서 걸린다", () => {
    const 예전글 = `기아 쏘렌토로 방문하신 고객님입니다.

주행거리는 126,726km였습니다.

타이어를 새로 교체하셨는데
편마모가 발견됐습니다.`;
    assert.equal(countSubheads(예전글), 0);
  });

  it("사진 자리표시자와 해시태그는 소제목이 아니다", () => {
    const t = `앞줄입니다.

[사진 A-04 - 차량 정면]

#속초타이어 #얼라인먼트

뒷줄입니다.`;
    assert.equal(countSubheads(t), 0);
  });
});

describe("구조 검사 — 소제목과 「오늘 정리」", () => {
  it("🔴 소제목이 모자라면 걸린다", () => {
    /* 소제목 줄만 빼면 예전 글 모양이 된다 — 그때 걸려야 한다 */
    const 밋밋한글 = GOOD.split("\n")
      .filter((l) => !["헌터 장비 정밀 측정", "캠버와 토우 교정", "시험 주행과 마무리"].includes(l.trim()))
      .join("\n");
    const r = styleFilter(밋밋한글);
    assert.ok(r);
    assert.match(r.reason, /소제목/);
  });

  it("🔴 「오늘 정리」가 없으면 걸린다", () => {
    const r = styleFilter(GOOD.replace("오늘 정리", "마치며"));
    assert.ok(r);
    assert.match(r.reason, /오늘 정리/);
  });
});
