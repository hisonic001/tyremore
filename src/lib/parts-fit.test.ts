import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { codeWordPattern, fitmentHasCode } from "./parts-fit-core";

/**
 * 🔴 이 시험이 지키는 것은 하나다 — **다른 차의 부품 품번이 붙지 않는 것.**
 *    적용 차종 글자는 사람이 손으로 적은 자유 문장이라 코드가 다른 낱말 안에 숨어 있다.
 *    `RBK`(투싼) 안의 `BK`(제네시스 쿠페)를 잡으면 그 순간 엉뚱한 패드를 권하게 된다.
 *    아래 글자들은 2026-09-04 에 우리 상품 자료에서 그대로 가져온 것이다.
 */
const 배터리 = "한국 배터리 DIN타입 · 호환 CMF57412 DIN74L · 쏘나타DN8,코나(디젤),i30/i40(디젤),더뉴K3(디젤)";
const 브레이크패드 = "(SP1247)_제네시스(BH) ('08.01~)뉴에쿠스(VI) 09년형 싼타페12년형(DM) ('12.04~)맥스크루즈";
const 에어필터 = "YF쏘나타 , K5 , K7 , 그랜저HG3.0 , 아슬란그랜저HG, 쏘렌토R(가솔린)";

describe("적용 차종 글자에 이 차종이 적혀 있나", () => {
  it("괄호 안에 든 코드를 찾는다 — `싼타페12년형(DM)`", () => {
    assert.equal(fitmentHasCode(브레이크패드, "DM"), true);
    assert.equal(fitmentHasCode(브레이크패드, "BH"), true);
    assert.equal(fitmentHasCode(브레이크패드, "VI"), true);
  });

  it("이름에 붙은 코드도 찾는다 — `쏘나타DN8` · `그랜저HG3.0`", () => {
    assert.equal(fitmentHasCode(배터리, "DN8"), true);
    assert.equal(fitmentHasCode(에어필터, "HG"), true);
    assert.equal(fitmentHasCode(에어필터, "YF"), true);
  });

  it("🔴 다른 낱말 안에 든 것은 안 찾는다 — 이게 안전장치다", () => {
    assert.equal(fitmentHasCode("2018RBK-8 투싼", "BK"), false, "RBK 안의 BK 를 잡으면 안 된다");
    assert.equal(fitmentHasCode(배터리, "MF"), false, "CMF57412 안의 MF 를 잡으면 안 된다");
    assert.equal(fitmentHasCode(배터리, "IN"), false, "DIN74L 안의 IN 을 잡으면 안 된다");
  });

  it("🔴 없는 차종은 없다고 한다 — 비슷한 이름이어도", () => {
    assert.equal(fitmentHasCode(브레이크패드, "TM"), false, "싼타페 DM 자료에 TM 이 붙으면 안 된다");
    assert.equal(fitmentHasCode(에어필터, "DN8"), false);
  });

  it("대소문자는 가리지 않는다 — 사람이 소문자로도 적는다", () => {
    assert.equal(fitmentHasCode("쏘나타dn8 적용", "DN8"), true);
  });

  it("코드에 정규식 기호가 섞여도 글자 그대로 찾는다", () => {
    assert.equal(fitmentHasCode("차종 A.B 적용", "A.B"), true);
    assert.equal(fitmentHasCode("차종 AXB 적용", "A.B"), false, "점을 아무 글자로 읽으면 안 된다");
  });

  it("규칙은 한 곳에서 만든다 — SQL 과 화면이 같은 것을 쓴다", () => {
    assert.equal(codeWordPattern("DM"), "(^|[^A-Za-z0-9])DM([^A-Za-z0-9]|$)");
  });
});
