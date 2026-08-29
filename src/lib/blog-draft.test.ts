/**
 * 블로그 초안 — 개인정보 필터·사실 문장 (마케팅 1단계, 2026-08-29)
 *
 * 핵심은 하나다: **API 로 나가는 글자와 화면에 나오는 글자에 개인정보가 없어야 한다.**
 * 모델은 가끔 지시를 어기므로 출력 필터가 마지막 방어선이다.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeForCopy, duplicateWarn, factsText, mileageBand, OWNER_SLOT, privacyFilter, seasonPhrase, type DraftFacts } from "./blog-draft-core";

const facts: DraftFacts = {
  quoteId: 1,
  quoteNo: "Q26-0829-001",
  maker: "현대자동차",
  model: "그랜저",
  year: 2019,
  mileageBand: mileageBand(82_400),
  tires: [{ name: "Primacy 4", spec: "235/45R18", qty: 4 }],
  services: ["휠얼라인먼트"],
  season: seasonPhrase("2026-08-29"),
  redact: ["김철수", "비회원 박영희 010-1234-5678"],
};

describe("지시문에 들어가는 사실", () => {
  it("주행거리는 만 단위로 뭉개고 날짜는 계절로만", () => {
    assert.equal(mileageBand(82_400), "8만km대");
    assert.equal(mileageBand(3_200), "1만km 미만");
    assert.equal(mileageBand(null), null);
    assert.equal(seasonPhrase("2026-08-29"), "8월 말, 한여름");
    assert.equal(seasonPhrase("2026-12-03"), "12월 초, 초겨울");
  });
  it("사실 문장에 이름·번호판·정확한 km 가 없다", () => {
    const t = factsText(facts);
    assert.match(t, /그랜저 2019년식, 주행 8만km대/);
    assert.match(t, /Primacy 4 235\/45R18 4본/);
    assert.doesNotMatch(t, /김철수|박영희|82,?400|010/);
  });
});

describe("개인정보 2차 필터", () => {
  it("번호판·전화·손님 이름이 나오면 잡는다", () => {
    assert.equal(privacyFilter("오늘 12가3456 그랜저가 왔습니다", []), "번호판으로 보이는 글자");
    assert.equal(privacyFilter("문의는 010-1234-5678", []), "전화번호로 보이는 글자");
    assert.match(privacyFilter("김철수 님 차량", facts.redact) ?? "", /손님 이름/);
    assert.equal(privacyFilter("235/45R18 4본을 끼웠습니다. 2019년식 8만km대", facts.redact), null);
  });
  it("규격·연식·본수 같은 정상 숫자는 안 잡는다", () => {
    assert.equal(privacyFilter("205/55R16 2011년식 22만km대 4본 2026년", []), null);
  });
});

describe("복사본·중복 경고", () => {
  it("사장님 한마디가 자리에 들어가고 태그는 #으로", () => {
    const out = composeForCopy(
      { titles: ["제목A", "제목B", "제목C"], body: `첫 문단\n\n${OWNER_SLOT}\n\n끝`, tags: ["속초 타이어", "#그랜저"], ownerNote: " 안쪽만 닳아 있었습니다 " },
      1,
    );
    assert.equal(out, "제목B\n\n첫 문단\n\n안쪽만 닳아 있었습니다\n\n끝\n\n#속초타이어 #그랜저");
  });
  it("최근 글에 같은 차종이 있으면 경고", () => {
    assert.match(duplicateWarn(facts, ["속초 그랜저 타이어 교체기"]) ?? "", /같은 차종/);
    assert.equal(duplicateWarn(facts, ["속초 소나타 타이어"]), null);
  });
});
