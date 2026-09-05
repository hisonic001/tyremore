import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { cleanRead, crossCheck, matchGeneration, looksPersonal } from "./vin-photo-core";

/**
 * 🔴 **틀린 값은 없는 것보다 나쁘다.** 규격이 틀리면 엉뚱한 타이어를 끼운다.
 *    그래서 모양이 안 맞으면 고치지 말고 **버려야** 한다 — 그걸 여기서 못 박는다.
 */
const 오늘 = new Date("2026-09-05T00:00:00+09:00");

describe("차대번호 — 모양이 안 맞으면 버린다", () => {
  it("제대로 된 17자리는 통과한다", () => {
    const r = cleanRead({ vin: "KNAPB81CBLK123456" }, 오늘);
    assert.equal(r.vin, "KNAPB81CBLK123456");
    assert.equal(r.dropped.length, 0);
  });

  it("공백·붙임표가 섞여도 살려 낸다", () => {
    const r = cleanRead({ vin: "knapb81cb lk-123456" }, 오늘);
    assert.equal(r.vin, "KNAPB81CBLK123456");
  });

  it("🔴 16자리는 버린다 — 고쳐서 쓰면 안 된다", () => {
    const r = cleanRead({ vin: "KNAPB81CBLK12345" }, 오늘);
    assert.equal(r.vin, null);
    assert.match(r.dropped.join(" "), /17자리 모양이 아니라/);
  });

  it("🔴 I·O·Q 가 든 것은 버린다 — 1·0 을 잘못 본 것이다", () => {
    assert.equal(cleanRead({ vin: "KNAPB81CBIK123456" }, 오늘).vin, null);
    assert.equal(cleanRead({ vin: "KNAPB81CBOK123456" }, 오늘).vin, null);
  });

  it("「확인 불가」 같은 말은 값이 아니다", () => {
    for (const v of ["없음", "확인 불가", "N/A", "-"]) {
      assert.equal(cleanRead({ vin: v }, 오늘).vin, null, v);
    }
  });
});

describe("타이어 규격 — 제원 DB 와 같은 자", () => {
  it("제대로 된 규격은 통과한다", () => {
    const r = cleanRead({ tireFront: "235/55r19", tireRear: "235/55R19" }, 오늘);
    assert.equal(r.tireFront, "235/55R19");
    assert.equal(r.tireRear, "235/55R19");
  });

  it("🔴 규격이 아닌 것은 버린다", () => {
    const r = cleanRead({ tireFront: "225-45-17" }, 오늘);
    assert.equal(r.tireFront, null);
    assert.match(r.dropped.join(" "), /규격 모양이 아니라/);
  });
});

describe("공기압 — 상식 범위만", () => {
  it("psi 는 그대로", () => {
    assert.equal(cleanRead({ psiFront: 35 }, 오늘).psiFront, 35);
  });

  it("🔴 kPa 로 적힌 것은 psi 로 바꾼다 — 240kPa 를 240psi 로 읽으면 타이어가 터진다", () => {
    const r = cleanRead({ psiFront: 240 }, 오늘);
    assert.ok(r.psiFront !== null && r.psiFront > 33 && r.psiFront < 36, String(r.psiFront));
  });

  it("말도 안 되는 값은 버린다", () => {
    assert.equal(cleanRead({ psiFront: 3 }, 오늘).psiFront, null);
    assert.equal(cleanRead({ psiFront: 900 }, 오늘).psiFront, null);
  });
});

describe("연식 — 있을 수 없는 값은 버린다", () => {
  it("정상 연식", () => {
    assert.equal(cleanRead({ year: 2019 }, 오늘).year, 2019);
  });
  it("1800년·2099년은 버린다", () => {
    assert.equal(cleanRead({ year: 1800 }, 오늘).year, null);
    assert.equal(cleanRead({ year: 2099 }, 오늘).year, null);
  });
});

/**
 * 🔴 **개인정보 2차 방어.** 지시문에서 읽지 말라고 못 박아도 모델이 어길 수 있다.
 *    등록증에는 소유자 이름·주소가 같이 찍힌다.
 */
describe("개인정보가 섞여 오면 그 칸을 통째로 버린다", () => {
  it("번호판·전화·주소·이름 표시를 알아본다", () => {
    assert.ok(looksPersonal("264저6834"));
    assert.ok(looksPersonal("010-1234-5678"));
    assert.ok(looksPersonal("강원 속초시 중앙로 12"));
    assert.ok(looksPersonal("소유자 홍길동"));
    assert.ok(!looksPersonal("쏘렌토"));
    assert.ok(!looksPersonal("MQ4"));
  });

  it("🔴 차명 자리에 주소가 오면 버린다", () => {
    const r = cleanRead({ carName: "강원 속초시 중앙로 12" }, 오늘);
    assert.equal(r.carName, null);
    assert.match(r.dropped.join(" "), /개인정보/);
  });
});

describe("두 눈으로 보기 — 차대번호와 라벨이 어긋나면 말해 준다", () => {
  it("🔴 연식이 크게 어긋나면 경고한다", () => {
    /* K 로 시작하는 기아 차대번호, 10번째 자리 L = 2020년 */
    const r = cleanRead({ vin: "KNAPB81CBLK123456", year: 2015 }, 오늘);
    const w = crossCheck(r);
    assert.ok(w.length > 0, "경고가 없다");
    assert.match(w.join(" "), /년식|년으로/);
  });

  it("한두 해 차이는 넘어간다 — 제작 연도와 등록 연도가 다를 수 있다", () => {
    const r = cleanRead({ vin: "KNAPB81CBLK123456", year: 2021 }, 오늘);
    assert.equal(crossCheck(r).length, 0);
  });

  it("차대번호가 없으면 맞춰 볼 것도 없다", () => {
    assert.deepEqual(crossCheck(cleanRead({ year: 2020 }, 오늘)), []);
  });
});

describe("세대 맞추기 — 둘 이상이면 고르지 않는다", () => {
  const gens = [
    { variantKey: "MQ4", label: "쏘렌토 (MQ4)" },
    { variantKey: "UM", label: "쏘렌토 (UM)" },
    { variantKey: "CN7", label: "아반떼 (CN7)" },
    { variantKey: "BK", label: "티볼리 (BK)" },
    { variantKey: "RBK", label: "코란도 (RBK)" },
  ];

  it("형식 코드가 맞으면 하나로 확정된다", () => {
    const m = matchGeneration(cleanRead({ modelCode: "MQ4" }, 오늘), gens);
    assert.equal(m.pick?.variantKey, "MQ4");
  });

  it("🔴 RBK 가 BK 에 걸리면 안 된다 — 낱말 경계", () => {
    const m = matchGeneration(cleanRead({ modelCode: "RBK" }, 오늘), gens);
    assert.equal(m.pick?.variantKey, "RBK");
  });

  it("🔴 차명만 있고 세대가 여럿이면 고르지 않는다", () => {
    const m = matchGeneration(cleanRead({ carName: "쏘렌토" }, 오늘), gens);
    assert.equal(m.pick, null);
    assert.equal(m.candidates.length, 2);
    assert.match(m.why, /골라 주세요/);
  });

  it("차명으로 하나면 확정된다", () => {
    const m = matchGeneration(cleanRead({ carName: "아반떼" }, 오늘), gens);
    assert.equal(m.pick?.variantKey, "CN7");
  });

  it("못 찾으면 못 찾았다고 한다 — 아무거나 주지 않는다", () => {
    const m = matchGeneration(cleanRead({ carName: "없는차" }, 오늘), gens);
    assert.equal(m.pick, null);
    assert.equal(m.candidates.length, 0);
  });
});

/**
 * 🔴 **두 번 읽기는 만능이 아니다** (2026-09-05 실측).
 *    흐린 사진에서 모델이 8을 6으로 **두 번 다 똑같이** 읽었다. 그래서 「두 번 같으면
 *    맞다」고 말하면 안 된다. 다를 때 말해 주는 것까지가 기계가 할 수 있는 전부이고,
 *    한 글자씩 맞춰 보는 것은 사장님 몫이다 — 화면이 그렇게 말한다.
 */
describe("두 번 읽어 다르면 말해 준다", () => {
  it("다르면 경고한다", () => {
    const r = cleanRead({ vin: "KNAPB81CBLK123456" }, 오늘);
    const w = crossCheck(r, false);
    assert.match(w.join(" "), /두 번 읽었는데 서로 달랐습니다/);
  });

  it("같으면 경고하지 않는다 — 다만 「맞다」는 뜻은 아니다", () => {
    const r = cleanRead({ vin: "KNAPB81CBLK123456" }, 오늘);
    assert.equal(crossCheck(r, true).length, 0);
  });

  it("차대번호가 아예 없으면 맞춰 볼 것도 없다", () => {
    assert.deepEqual(crossCheck(cleanRead({}, 오늘), false), []);
  });
});
