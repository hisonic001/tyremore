import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { factsText, privacyFilter, type DraftFacts } from "./blog-draft-core";

/**
 * 🔴 **거래처(렌트카·정비소) 이름이 글에 새면 안 된다** (사장님 지시 2026-09-05 —
 *    「렌트카라고 안 나왔으면 좋겠음」).
 *
 *    막는 곳이 두 군데다:
 *      ① `factsText()` 가 애초에 안 보낸다 — 차량·시공·작업·시기·매장 다섯 줄뿐이다
 *      ② 그래도 모델이 쓰면 `privacyFilter()` 가 되돌린다 (redact 목록)
 *    ①이 무너지면 ②만 남으니, 둘 다 시험으로 못 박는다.
 */
const 거래처건: DraftFacts = {
  quoteId: 3595,
  quoteNo: "Q26-0903-005",
  maker: null,
  model: "K8",
  year: null,
  mileage: 17408,
  mileageBand: "1만km대",
  tires: [],
  services: ["엔진오일 교환", "에어컨 필터 교환", "전조등/와이퍼 점검"],
  season: "9월 초, 여름 끝물",
  redact: ["AJ렌트카", "거래처 AJ렌트카"],
};

describe("거래처 이름은 글에 안 나간다", () => {
  it("🔴 AI 에 보내는 재료에 거래처 이름이 없다", () => {
    const t = factsText(거래처건);
    assert.ok(!t.includes("AJ렌트카"), "거래처 이름이 재료에 들어갔다");
    assert.ok(!t.includes("렌트카"), "「렌트카」라는 말이 재료에 들어갔다");
  });

  it("재료에는 차량·작업·시기·매장만 들어간다", () => {
    const t = factsText(거래처건);
    assert.ok(t.includes("K8"));
    assert.ok(t.includes("17,408km"));
    assert.ok(t.includes("엔진오일 교환"));
    assert.ok(t.includes("타이어모어 속초점"));
  });

  it("🔴 그래도 원고에 거래처 이름이 나오면 걸린다", () => {
    const r = privacyFilter("오늘은 AJ렌트카 차량이 왔습니다.", 거래처건.redact);
    assert.ok(r, "거래처 이름이 안 걸렸다");
  });

  it("깨끗한 글은 통과한다", () => {
    assert.equal(privacyFilter("K8 엔진오일을 갈았습니다.", 거래처건.redact), null);
  });
});

describe("타이어가 없는 경정비 건도 재료가 나온다", () => {
  it("🔴 엔진오일만 있어도 「작업」 줄이 나온다 — 빈 재료를 보내면 안 된다", () => {
    const t = factsText(거래처건);
    assert.match(t, /^작업: 엔진오일 교환/m);
    assert.ok(!t.includes("시공:"), "타이어가 없는데 「시공」 줄이 나왔다");
  });

  it("품목이 하나도 없으면 사장님 후기로 쓰라고 알려 준다", () => {
    const t = factsText({ ...거래처건, services: [] });
    assert.match(t, /사장님이 적으신 후기와 사진으로 쓰세요/);
  });
});
