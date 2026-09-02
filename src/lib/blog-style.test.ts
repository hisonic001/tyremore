import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildSystem, styleFilter } from "./blog-style";

/**
 * 「AI 가 쓴 티」 검사 — 사장님 지적(2026-09-02)에서 나온 규칙들.
 * 실제로 나왔던 나쁜 글과 사장님이 발행하신 좋은 글을 각각 표본으로 쓴다.
 */

/** 사장님이 실제로 발행하신 글의 결 — 짧은 줄, 마크다운 없음, 그날의 일로 시작 */
const GOOD = `기아 쏘렌토 하이브리드로 방문하신
고객님, 이번이 두 번째 방문이었습니다.

주행거리는 126,726km였고, 이번 방문
목적은 얼라인먼트 조정이었습니다.

타이어 교체 시 저희가 먼저 하는 것

저희 타이어모어 속초점은 단순히
타이어를 탈부착하고 끝내지 않습니다.

교체 시 탈거한 기존 타이어의
마모 패턴과 형상을 꼼꼼하게 분석해
어디서 문제가 시작됐는지 파악합니다.

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

describe("buildSystem — 사장님 글을 본보기로", () => {
  it("표본이 있으면 지시문에 그대로 들어간다", () => {
    const s = buildSystem([GOOD]);
    assert.ok(s.includes("실제로 발행한 글"));
    assert.ok(s.includes("126,726km"));
  });

  it("표본이 없어도 규칙만으로 지시문이 만들어진다 (Vercel 쪽 대비)", () => {
    const s = buildSystem([]);
    assert.ok(!s.includes("실제로 발행한 글"));
    assert.ok(s.includes("마크다운"));
  });

  it("너무 짧은 표본은 본보기로 안 쓴다", () => {
    const s = buildSystem(["짧은 글"]);
    assert.ok(!s.includes("실제로 발행한 글"));
  });

  it("표본은 두 편까지만 — 지시문이 무거워지면 본문 쓸 여력이 준다", () => {
    const s = buildSystem([GOOD, GOOD, GOOD]);
    assert.equal(s.split("사장님 실제 글").length - 1, 2);
  });
});
