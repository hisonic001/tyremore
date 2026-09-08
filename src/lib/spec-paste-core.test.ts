import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { inchOf, parseSpecPaste } from "./spec-paste-core";

/**
 * 🔴 이 글자는 **사장님이 2026-09-08 에 실제로 붙여넣으신 것**을 그대로 옮긴 것이다.
 *    지어낸 예제로 시험하면 진짜 자료에서 어긋난다.
 */
const 붙여넣은것 = `세부모델
[제원] 엔진
엔진형식
연료
배기량
최고출력
최대토크
친환경
[제원] 구동
굴림방식
변속기
서스펜션 (전)
서스펜션 (후)
브레이크 (전)
브레이크 (후)
타이어 (전)
타이어 (후)
휠 (전)
휠 (후)
[제원] 연비
복합연비
도심연비
고속연비
CO₂ 배출
에너지소비효율
[제원] 제원
전장
전폭
전고
축거
윤거 (전)
윤거 (후)
승차정원
공차중량
연료탱크
[사양·옵션] 외관
헤드램프
헤드램프 부가기능
주간 주행등

모던 (A/T)
31,700,000원
프리미엄 (A/T)
32,950,000원

익스클루시브 스페셜 (A/T)
36,750,000원

기아 K7 프리미어 하이브리드 제원 정보

직렬 4기통    직렬 4기통    직렬 4기통
가솔린    가솔린    가솔린
2,359 cc    2,359 cc    2,359 cc
190/6,000 ps/rpm    190/6,000 ps/rpm    190/6,000 ps/rpm
24.6/4,000 kg.m/rpm    24.6/4,000 kg.m/rpm    24.6/4,000 kg.m/rpm
저공해 3종    저공해 3종    저공해 3종

FF    FF    FF
자동 6단    자동 6단    자동 6단
맥퍼슨 스트럿    맥퍼슨 스트럿    맥퍼슨 스트럿
멀티링크    멀티링크    멀티링크
벤틸레이티드 디스크    벤틸레이티드 디스크    벤틸레이티드 디스크
디스크    디스크    디스크
225/55R    225/55R    245/45R
225/55R    225/55R    245/45R
17 인치    17 인치    18 인치
17 인치    17 인치    18 인치

11.2 km/ℓ    11.2 km/ℓ    11.0 km/ℓ
9.8 km/ℓ    9.8 km/ℓ    9.7 km/ℓ
13.6 km/ℓ    13.6 km/ℓ    13.3 km/ℓ
150 g/km    150 g/km    153 g/km
4 등급    4 등급    4 등급

4,930 mm    4,930 mm    4,930 mm
1,865 mm    1,865 mm    1,865 mm
1,470 mm    1,470 mm    1,470 mm
2,845 mm    2,845 mm    2,845 mm
1,612 mm    1,612 mm    1,607 mm
1,620 mm    1,620 mm    1,615 mm
5    5    5
1,550 kg    1,550 kg    1,570 kg
70 ℓ    70 ℓ    70 ℓ
`;

describe("제원 페이지를 통째로 붙여넣기", () => {
  const got = parseSpecPaste(붙여넣은것);

  it("읽힌다", () => {
    assert.ok(got, "못 읽었습니다");
  });

  it("세부모델 셋을 찾는다", () => {
    assert.deepEqual(got!.trims, ["모던 (A/T)", "프리미엄 (A/T)", "익스클루시브 스페셜 (A/T)"]);
  });

  it("🔴 타이어에 인치를 붙여 준다 — 다나와는 인치를 휠 칸에 따로 적는다", () => {
    const 앞 = got!.items.find((i) => i.item === "tire_size" && i.qualifier === "앞")!;
    assert.deepEqual(앞.values, ["225/55R17", "225/55R17", "245/45R18"]);
    const 뒤 = got!.items.find((i) => i.item === "tire_size" && i.qualifier === "뒤")!;
    assert.deepEqual(뒤.values, ["225/55R17", "225/55R17", "245/45R18"]);
  });

  it("휠은 인치 그대로 — J 폭이 없는 게 정상이다", () => {
    const w = got!.items.find((i) => i.item === "wheel_size" && i.qualifier === "앞")!;
    assert.deepEqual(w.values, ["17 인치", "17 인치", "18 인치"]);
  });

  it("연료탱크는 숫자만 뽑는다", () => {
    const f = got!.items.find((i) => i.item === "fuel_tank_qty")!;
    assert.deepEqual(f.values, ["70", "70", "70"]);
  });

  it("엔진을 가를 참고값을 같이 준다", () => {
    const 연료 = got!.hints.find((h) => h.label === "연료")!;
    assert.deepEqual(연료.values, ["가솔린", "가솔린", "가솔린"]);
    const 배기량 = got!.hints.find((h) => h.label === "배기량")!;
    assert.equal(배기량.values[0], "2,359 cc");
  });

  it("🔴 트림마다 값이 다른 것을 그대로 살린다", () => {
    const 앞 = got!.items.find((i) => i.item === "tire_size" && i.qualifier === "앞")!;
    assert.notEqual(앞.values[0], 앞.values[2], "모던과 익스클루시브는 타이어가 다르다");
  });
});

describe("🔴 어긋난 묶음은 통째로 버린다", () => {
  it("라벨과 값의 줄 수가 다르면 그 묶음을 안 읽는다", () => {
    /* 사양·옵션 쪽은 값이 여러 줄이라 실제로 어긋난다 */
    const 어긋난것 = `세부모델
[제원] 구동
타이어 (전)
휠 (전)

모던
1,000원

제원 정보

225/55R
17 인치
군더더기 한 줄 더
`;
    const got = parseSpecPaste(어긋난것);
    assert.ok(got);
    assert.equal(got!.items.length, 0, "어긋난 묶음에서 값을 읽으면 안 된다");
    assert.ok(got!.warn.length > 0, "왜 못 읽었는지 말해 줘야 한다");
  });

  it("제원 쪽이 아니면 아예 null", () => {
    assert.equal(parseSpecPaste("아무 글이나"), null);
    assert.equal(parseSpecPaste(""), null);
  });
});

describe("인치 읽기", () => {
  it("여러 표기를 읽는다", () => {
    assert.equal(inchOf("17 인치"), 17);
    assert.equal(inchOf("18인치"), 18);
    assert.equal(inchOf('20"'), 20);
  });

  it("상식 밖은 안 받는다", () => {
    assert.equal(inchOf("99 인치"), null);
    assert.equal(inchOf("아무거나"), null);
    assert.equal(inchOf(null), null);
  });
});
