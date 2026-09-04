import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { looksLikeVin, parseVin, vinModelKey, VIN_MODEL_LEN } from "./vin";

/**
 * 🔴 아래 앞자리는 **우리 매장 실제 차**에서 가져온 것이다 (뒤 6자리는 지웠다).
 *    차대번호로 읽을 수 있는 것은 제조사·연식뿐이고, **차종은 못 읽는다** —
 *    그 사실을 시험으로 못 박아 둔다.
 */
const 싼타페DM = "KMHSW81UBDU000000";
const 포터2 = "KMFZCZ7KBBU000000";
const SM5 = "KNMA4C2BME P000000".replace(" ", "");

describe("차대번호 읽기 — 제조사·연식", () => {
  it("국산 제조사를 읽는다", () => {
    assert.equal(parseVin(싼타페DM).maker, "현대");
    assert.equal(parseVin(포터2).maker, "현대 (상용)");
    assert.equal(parseVin(SM5).maker, "르노코리아");
    assert.equal(parseVin("KNAPB81BBLA000000").maker, "기아");
    assert.equal(parseVin("KMTG341CBLU000000").maker, "제네시스");
  });

  it("수입 제조사도 읽는다", () => {
    assert.equal(parseVin("WBA5A5C50ED000000").maker, "BMW");
    assert.equal(parseVin("WDD2130361A000000").maker, "메르세데스-벤츠");
  });

  it("모르는 제작사면 국가만이라도 알려 준다", () => {
    const r = parseVin("ZZZ1234567A000000");
    assert.equal(r.maker, "미등록 제조사");
    assert.equal(r.country, "이탈리아");
  });

  it("🔴 10번째 글자가 연식이다 — 이건 국제 규격이라 확실하다", () => {
    assert.equal(parseVin(싼타페DM).year, 2013); // D
    assert.equal(parseVin(포터2).year, 2011); // B
    assert.equal(parseVin("KMHXX81UBNU000000").year, 2022); // N
    assert.equal(parseVin("KMHXX81UB9U000000").year, 2009); // 9
  });

  it("뒤 6자리는 제작일련번호 — 부품가게가 이걸로 차를 특정한다", () => {
    assert.equal(parseVin("KMHSW81UBDU123456").serial, "123456");
  });
});

describe("차대번호 흠 잡기 — 손으로 칠 때 실제로 나는 실수", () => {
  it("17자리가 아니면 짚어 준다", () => {
    const r = parseVin("KMHSW81UBDU");
    assert.equal(r.valid, false);
    assert.match(r.problems[0], /17자리/);
  });

  it("🔴 I·O·Q 는 차대번호에 없는 글자다 — 1·0 을 잘못 본 것이다", () => {
    const r = parseVin("KMHSW81UBDUO00000");
    assert.equal(r.valid, false);
    assert.match(r.problems.join(" "), /숫자 0 을 잘못 본 것/);
    const q = parseVin("KMHSW81UBDUQ00000");
    assert.match(q.problems.join(" "), /9나 0/);
  });

  it("모양 검사", () => {
    assert.equal(looksLikeVin("KMHSW81UBDU000000"), true);
    assert.equal(looksLikeVin("kmhsw81ubdu000000"), true);
    /* 사람은 띄어 쓰거나 하이픈을 넣는다 — 지우고 센다 */
    assert.equal(looksLikeVin("KMH-SW81U BDU000000"), true);
    assert.equal(looksLikeVin("KMHSW81UBDU00000"), false); // 16자리
    assert.equal(looksLikeVin("KMHSW81UBDUI00000"), false); // I 는 못 쓴다
    assert.equal(looksLikeVin("12가3456"), false);
  });
});

describe("차종을 가리키는 자리", () => {
  it("🔴 앞 9자리다 — 법이 정한 제작사군(1~3)+자동차특성군(4~9)", () => {
    assert.equal(VIN_MODEL_LEN, 9);
    assert.equal(vinModelKey(싼타페DM), "KMHSW81UB");
  });

  it("10·11번째는 연식·공장이라 차종과 무관하다 — 열쇠에 넣지 않는다", () => {
    const a = vinModelKey("KMHSW81UBDU000000"); // 2013
    const b = vinModelKey("KMHSW81UBGU999999"); // 2016
    assert.equal(a, b, "같은 차종이면 연식이 달라도 같은 열쇠여야 한다");
  });

  it("17자리가 아니면 열쇠를 만들지 않는다", () => {
    assert.equal(vinModelKey("KMHSW81U"), null);
  });
});
