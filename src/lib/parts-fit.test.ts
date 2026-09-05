import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  codeWordPattern,
  engineNear,
  fitConditions,
  fitmentHasCode,
  foreignNear,
  oemPartNos,
} from "./parts-fit-core";

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
    assert.equal(codeWordPattern("DM"), "(^|[^A-Za-z0-9-])DM([^A-Za-z0-9-]|$)");
  });

  it("🔴 붙임표 건너로는 안 넘어간다 — 2026-09-05 에 실제로 당한 것들", () => {
    assert.equal(fitmentHasCode("HI-Q SP1117_EF쏘나타, 라비타", "HI"), false, "금호 브랜드 HI-Q 에 G90 HI 가 붙었다 (91건)");
    assert.equal(fitmentHasCode("LEXUS /CT200H /2ZRFXE  TOYOTA /C-HR", "HR"), false, "렉서스 C-HR 에 포터2 HR 이 붙었다");
    assert.equal(fitmentHasCode("FILTER-AIR · 품번 68247339AA", "AIR"), false, "FILTER-AIR 에 에쿠스 AIR 가 붙었다");
    /* 그래도 제대로 된 짝은 그대로 찾는다 — 실측으로 잃은 정상 짝은 0이었다 */
    assert.equal(fitmentHasCode(브레이크패드, "DM"), true);
    assert.equal(fitmentHasCode(배터리, "DN8"), true);
  });
});

/**
 * 🔴 순정 품번 — 사장님이 부품상에 주문할 때 부르는 번호다.
 *    우리 상품코드(`MBA-049_MOBIS`)와 **다르다**. 헷갈리면 주문이 안 된다.
 */
describe("적용 차종 글자에서 순정 품번 꺼내기", () => {
  it("「품번」 낱말 뒤를 집는다", () => {
    assert.deepEqual(oemPartNos("쏘렌토MQ4 2.2디젤 · 품번 26350-2T000"), ["26350-2T000"]);
    assert.deepEqual(oemPartNos("쏘울 · 품번 97133-2K000"), ["97133-2K000"]);
    assert.deepEqual(oemPartNos("카니발 · 품번 0K55361C14"), ["0K55361C14"], "기아 구형 모양도 받는다");
  });

  it("빗금으로 나란히 적힌 품번은 둘로 나눈다", () => {
    assert.deepEqual(oemPartNos("도요타 · 품번 04152-37010/04152-YZZA6"), ["04152-37010", "04152-YZZA6"]);
  });

  it("쉼표로 여럿 적힌 것도 다 꺼낸다", () => {
    assert.deepEqual(oemPartNos("품번 : 26320-2F000,26320-2F100"), ["26320-2F000", "26320-2F100"]);
  });

  it("🔴 품번이 아닌 것을 품번이라 하지 않는다", () => {
    assert.deepEqual(oemPartNos(배터리), [], "「품번」 낱말이 없으면 아무것도 안 낸다");
    assert.deepEqual(oemPartNos(브레이크패드), []);
    assert.deepEqual(oemPartNos(에어필터), []);
    assert.deepEqual(oemPartNos("2026-08-14 입고 · 010-1234-5678"), [], "날짜·전화번호는 품번이 아니다");
    assert.deepEqual(oemPartNos("235/60R18 적용"), [], "타이어 규격은 품번이 아니다");
    assert.deepEqual(oemPartNos(null), []);
  });

  it("🔴 우리 상품코드는 순정 품번이 아니다", () => {
    assert.deepEqual(oemPartNos("오일필터 MBA-049_MOBIS 쏘렌토"), [], "「품번」 낱말이 없으니 안 낸다");
  });
});

/**
 * 🔴 엔진이 다르면 부품이 다르다 (사장님 지시, 2026-09-05).
 *    한 상품 글에 차가 여럿 적혀 있고 엔진 표기는 **각자 자기 차 것**이다.
 */
describe("이 부품이 우리 차의 어느 엔진 것인가", () => {
  const 섞인글 =
    "스포티지NQ5,스타리아 하이브리드, 더뉴싼타페TM. 하이브리드 K5 DL3 , 투싼 NX4 가솔린 하이브리드 , 아반떼 CN7 쏘렌토MQ4 하이브리드 , 쏘나타DN8 1.6가솔린, 베뉴";

  it("🔴 옆 차의 엔진을 우리 차에 붙이지 않는다", () => {
    assert.equal(engineNear(섞인글, "DN8")?.label, "1.6 가솔린", "쏘나타 것은 1.6가솔린이다");
    assert.equal(engineNear(섞인글, "MQ4")?.label, "하이브리드", "쏘렌토 것은 하이브리드다");
  });

  it("코드 바로 뒤에 적힌 엔진을 읽는다", () => {
    assert.equal(engineNear("쏘렌토MQ4 2.2디젤 GV70 2.2디젤", "MQ4")?.label, "2.2 디젤");
    assert.equal(engineNear("싼타페TM(디젤) · 품번 28113-A9200", "TM")?.label, "디젤");
  });

  it("글 맨 앞 괄호는 목록 전체에 걸린다", () => {
    const g = engineNear("(가솔린) 팰리세이드,올뉴카니발,올뉴쏘렌토,싼타페DM,싼타페TM · 품번 28113-A9100", "TM");
    assert.equal(g?.label, "가솔린");
    assert.equal(g?.from, "앞머리");
  });

  it("「(순정부품)」 은 우리 표시라 건너뛴다", () => {
    assert.equal(engineNear("(순정부품)(하이브리드) 소나타DN8/ 쏘렌토MQ4", "DN8")?.label, "하이브리드");
  });

  it("🔴 못 읽으면 짐작하지 않고 null 을 낸다", () => {
    assert.equal(engineNear("쏘나타DN8 , K5 DL3 · 품번 26350-2J000", "DN8"), null);
    assert.equal(engineNear(에어필터, "YF"), null);
    assert.equal(engineNear(null, "DN8"), null);
  });
});

/**
 * 🔴 국산차에 수입차 부품을 권하면 사장님이 그대로 주문하신다.
 *    아래 넷은 2026-09-05 에 **실제로 배포된 화면에서** 찾은 것이다.
 */
describe("남의 차 부품 걸러내기", () => {
  it("코드 언저리에 수입차 이름이 있으면 우리 차 것이 아니다", () => {
    assert.ok(foreignNear("JAGUAR XE(JA) (D1861) 4S 하겐 C/F", "JA"), "모닝 JA 에 재규어가 붙었다");
    assert.ok(foreignNear("HONDA ACURA TL 99-08 하겐 C/F", "TL"), "투싼 TL 에 혼다가 붙었다");
    assert.ok(foreignNear("지프,크라이슬러JEEP WRANGLER JK,CHRYSLER 300 LX", "JK"), "GV70 JK 에 지프가 붙었다");
    assert.ok(foreignNear("재규어,랜드로버_MANN(HU826x)ALL NEW XF / F-PACE", "ALL"), "말리부 ALL 에 재규어가 붙었다");
  });

  it("🔴 국산차와 같이 적힌 공용 부품은 안 걸러낸다 — 그건 진짜 우리 차에도 맞는다", () => {
    assert.equal(foreignNear(에어필터, "HG"), null);
    assert.equal(foreignNear("쏘렌토MQ4 2.2디젤 · 품번 26350-2T000", "MQ4"), null);
  });
});

/**
 * 브레이크패드는 엔진이 아니라 **앞·뒤와 휠 인치**로 갈린다 —
 * 모닝 JA 는 13인치·14인치·리어로 셋이다.
 */
describe("부품이 갈리는 조건 읽기", () => {
  it("앞·뒤를 읽는다", () => {
    assert.equal(fitConditions("(SP1975)(HP1060)_올뉴모닝 R (JA),캐스퍼 13\" 14\"", "JA").axle, "뒤");
  });

  it("휠 인치를 읽는다", () => {
    assert.equal(fitConditions("(SP1983)_홀O_올뉴모닝 14\",캐스퍼 14\"모닝 17년형(JA) 14\"", "JA").inch, 14);
  });

  it("🔴 말이 안 되는 인치는 안 받는다", () => {
    assert.equal(fitConditions("올뉴모닝(JA) 99인치", "JA").inch, null);
  });

  it("엔진도 같이 읽는다", () => {
    assert.equal(fitConditions("쏘렌토MQ4 2.2디젤", "MQ4").engine, "2.2 디젤");
  });
});

/**
 * 빗금으로 이어진 차 목록 — 「아반떼HD/AD/MD디젤」의 디젤은 셋 다에 걸린다.
 * 2026-09-05 표본에서 MD 는 디젤로 읽고 AD 는 못 읽는 말 안 되는 결과가 나왔다.
 */
describe("빗금으로 이어진 차 목록", () => {
  const 와셔 = "(와셔) 아반떼HD/AD/MD디젤(20080219~), i30디젤, i40LF소나타 , 클릭디젤(20080219~)";

  it("빗금 건너 붙은 엔진을 셋 다 읽는다", () => {
    assert.equal(engineNear(와셔, "AD")?.label, "디젤");
    assert.equal(engineNear(와셔, "MD")?.label, "디젤");
    assert.equal(engineNear(와셔, "HD")?.label, "디젤");
  });

  it("🔴 빗금 뒤가 다른 차 이야기면 안 넘어간다", () => {
    assert.equal(
      engineNear("올뉴투산 / 팰리세이드 2.2 디젤", "TL"),
      null,
      "코드가 없으면 아무것도 안 낸다",
    );
    assert.equal(
      engineNear("싼타페더스타일/DM/CM , 투산 ix (디젤)", "DM"),
      null,
      "쉼표 건너 다른 차의 디젤을 끌어오면 안 된다",
    );
  });
});
