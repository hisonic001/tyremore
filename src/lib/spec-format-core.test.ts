import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonical, cleanPattern } from "./spec-format-core";

/**
 * 🔴 이 시험이 지키는 것 둘:
 *   ① **표기가 일정해진다** — 사장님이 어떻게 치셔도 저장은 한 모양이다
 *   ② **값을 고쳐서 통과시키지 않는다** — 범위 밖은 막는다. 잘라 넣으면 틀린 값이 깨끗해 보인다
 *
 * 아래 「이렇게 쳐도 받습니다」는 계획서의 정본 표기표를 그대로 옮긴 것이다.
 */

const 됨 = (item: string, raw: string, unit?: string | null, body?: string | null) => {
  const r = canonical(item, raw, unit, { bodyType: body ?? null });
  assert.equal(r.ok, true, `「${raw}」가 막혔습니다: ${r.why}`);
  return r;
};
const 막힘 = (item: string, raw: string, unit?: string | null, body?: string | null) => {
  const r = canonical(item, raw, unit, { bodyType: body ?? null });
  assert.equal(r.ok, false, `「${raw}」가 통과했습니다 (${r.display})`);
  assert.ok(r.why && r.why.length > 5, "왜 안 되는지 사장님이 읽을 말이 있어야 한다");
  return r;
};

describe("타이어 규격", () => {
  it("어떻게 쳐도 235/60R18 로 저장된다", () => {
    for (const raw of ["235/60R18", "235/60 R18", "235/60 r18", "235/60-R18", " 235 / 60 R 18 "]) {
      assert.equal(됨("tire_size", raw).textValue, "235/60R18", raw);
    }
  });

  it("🔴 뜻이 있는 접두·접미는 떼지 않는다", () => {
    assert.equal(됨("tire_size", "p235/60r18").textValue, "P235/60R18");
    assert.equal(됨("tire_size", "LT235/85R16").textValue, "LT235/85R16");
    assert.equal(됨("tire_size", "215/70r16c").textValue, "215/70R16 C", "C 는 승합·화물이다");
    assert.equal(됨("tire_size", "235/60R18xl").textValue, "235/60R18 XL");
  });

  it("상식 밖 숫자는 막는다", () => {
    막힘("tire_size", "235/60R99");
    막힘("tire_size", "935/60R18");
    막힘("tire_size", "18인치");
    막힘("tire_size", "235-60-18");
  });
});

describe("휠 규격", () => {
  it("어떻게 쳐도 7.5Jx18", () => {
    for (const raw of ["7.5Jx18", "7.5J x 18", "7.5j x18", "7.5J×18", "7.5J18"]) {
      assert.equal(됨("wheel_size", raw).textValue, "7.5Jx18", raw);
    }
  });

  it("🔴 J 가 없으면 휠 규격이 아니다", () => {
    막힘("wheel_size", "18인치");
    막힘("wheel_size", "18");
  });

  it("상식 밖은 막는다", () => {
    막힘("wheel_size", "7.5Jx99");
    막힘("wheel_size", "99Jx18");
  });
});

describe("엔진오일 점도", () => {
  it("어떻게 쳐도 0W-20", () => {
    for (const raw of ["0W-20", "0w20", "0W20", "0 w 20", " 0w-20 "]) {
      assert.equal(됨("engine_oil_viscosity", raw).textValue, "0W-20", raw);
    }
  });

  it("🔴 쓰지 않는 점도는 막는다", () => {
    막힘("engine_oil_viscosity", "0W-25");
    막힘("engine_oil_viscosity", "그냥아무거나");
  });
});

describe("브레이크액", () => {
  it("어떻게 쳐도 DOT 4", () => {
    for (const raw of ["DOT 4", "dot4", "DOT-4", "dot 4"]) {
      assert.equal(됨("brake_fluid_spec", raw).textValue, "DOT 4", raw);
    }
    assert.equal(됨("brake_fluid_spec", "dot4lv").textValue, "DOT 4 LV");
  });

  it("없는 규격은 막는다", () => {
    막힘("brake_fluid_spec", "DOT 9");
    막힘("brake_fluid_spec", "아무거나");
  });

  it("🔴 설명서 문장은 그대로 둔다 — DOT 4 만 뽑으면 나머지 규격을 버리는 것이다", () => {
    const 문장 = "SAE J1704 DOT-4 LV, ISO4925 CLASS-6, FMVSS 116 DOT-4";
    assert.equal(됨("brake_fluid_spec", 문장).textValue, 문장);
  });
});

describe("배터리 규격", () => {
  it("어떻게 쳐도 AGM80L", () => {
    for (const raw of ["AGM80L", "agm 80l", "AGM-80L", "agm-80-l"]) {
      assert.equal(됨("battery_size", raw).textValue, "AGM80L", raw);
    }
    assert.equal(됨("battery_size", "din 80 l").textValue, "DIN80L");
    assert.equal(됨("battery_size", "cmf60r").textValue, "CMF60R");
  });

  it("🔴 단자 방향이 없으면 안 받는다 — 틀리면 케이블이 안 닿는다", () => {
    막힘("battery_size", "AGM80");
    막힘("battery_size", "80Ah");
  });
});

describe("고르기로만 받는 항목", () => {
  it("목록에 있는 것만", () => {
    assert.equal(됨("battery_position", "트렁크").textValue, "트렁크");
    assert.equal(됨("battery_reset", "IBS 리셋 필요").textValue, "IBS 리셋 필요");
  });

  it("목록 밖은 막고, 무엇을 고를지 알려 준다", () => {
    const r = 막힘("battery_position", "보닛 안쪽");
    assert.ok(r.why!.includes("엔진룸"), "고를 수 있는 것을 적어 줘야 한다");
  });
});

describe("숫자와 단위", () => {
  it("공기압 기본 단위는 psi 이고 psi 를 앞에 보여 준다", () => {
    const r = 됨("tire_pressure", "35");
    assert.equal(r.unit, "psi");
    assert.equal(r.numMin, 35);
    assert.ok(r.display!.startsWith("35 psi"), r.display!);
  });

  it("kPa 로 넣으셔도 psi 를 앞에 보여 준다 — 원문 값은 그대로 둔다", () => {
    const r = 됨("tire_pressure", "240", "kPa");
    assert.equal(r.numMin, 240, "저장은 원문 그대로 240 이어야 한다");
    assert.equal(r.unit, "kPa");
    assert.ok(r.display!.startsWith("35 psi"), r.display!);
    assert.ok(r.display!.includes("240 kPa"), r.display!);
  });

  it("bar 로 넣으면 kPa 로 바꿔 받는다", () => {
    const r = 됨("tire_pressure", "2.4 bar");
    assert.equal(r.unit, "kPa");
    assert.equal(r.numMin, 240);
  });

  it("값에 단위를 같이 치셔도 읽는다", () => {
    assert.equal(됨("engine_oil_qty", "6.1 L").numMin, 6.1);
    assert.equal(됨("engine_oil_qty", "6.1리터").numMin, 6.1);
  });

  it("범위와 ± 를 읽는다", () => {
    const a = 됨("wheel_nut_torque", "11~13", "kgf·m", "승용");
    assert.equal(a.numMin, 11);
    assert.equal(a.numMax, 13);
    const b = 됨("oil_drain_plug_torque", "40±5", "N·m");
    assert.equal(b.numMin, 35);
    assert.equal(b.numMax, 45);
    assert.equal(됨("wheel_nut_torque", "11-13", "kgf·m", "승용").numMax, 13);
  });

  it("토크는 두 단위를 나란히 보여 준다", () => {
    const r = 됨("wheel_nut_torque", "11", "kgf·m", "승용");
    assert.ok(r.display!.includes("kgf·m") && r.display!.includes("N·m"), r.display!);
  });
});

describe("🔴 값을 고쳐서 통과시키지 않는다", () => {
  it("N·m 을 kgf·m 로 잘못 고르면 막고, 그 이유를 짚어 준다", () => {
    const r = 막힘("wheel_nut_torque", "110", "kgf·m", "승용");
    assert.ok(r.why!.includes("N·m"), `단위를 잘못 골랐다고 짚어 줘야 한다: ${r.why}`);
  });

  it("차체가 다르면 범위도 다르다 — 대형은 되고 승용은 막힌다", () => {
    됨("wheel_nut_torque", "50", "kgf·m", "대형");
    막힘("wheel_nut_torque", "50", "kgf·m", "승용");
  });

  it("범위 밖 값이 조용히 잘려 들어가지 않는다", () => {
    막힘("engine_oil_qty", "60", "L");
    막힘("tire_pressure", "500", "psi");
    막힘("battery_ah", "5", "Ah");
  });

  it("빈 값·모르는 항목", () => {
    막힘("tire_size", "   ");
    막힘("듣도보도못한항목", "무엇");
  });
});

describe("와이퍼는 위치별 숫자다", () => {
  it("mm 로 받는다", () => {
    const r = 됨("wiper_size", "650");
    assert.equal(r.unit, "mm");
    assert.equal(r.numMin, 650);
  });

  it("상식 밖 길이는 막는다", () => {
    막힘("wiper_size", "6500");
    막힘("wiper_size", "50");
  });
});

/**
 * 🔴 오일 규격은 **제조사가 쓴 문장**이라 손대면 뜻이 바뀐다.
 *    2026-09-08 에 실제 값 284건에 돌려 보고 알았다 — 대문자·쉼표 통일을 물렀다.
 */
describe("오일 규격은 띄어쓰기만 정리한다", () => {
  it("「또는」과 빗금을 건드리지 않는다 — 뜻이 바뀐다", () => {
    assert.equal(
      됨("engine_oil_spec", "API SN PLUS/SP 또는 ILSAC GF-6").textValue,
      "API SN PLUS/SP 또는 ILSAC GF-6",
      "「SN PLUS 또는 SP」가 두 개의 별개 규격이 되면 안 된다",
    );
    assert.equal(
      됨("transmission_oil_spec", "GS ATF SP-IV-RR, Genesis/Hyundai Genuine ATF SP-IV-RR").textValue,
      "GS ATF SP-IV-RR, Genesis/Hyundai Genuine ATF SP-IV-RR",
    );
  });

  it("겹친 공백과 쉼표 뒤 띄어쓰기만 맞춘다", () => {
    assert.equal(됨("engine_oil_spec", "  SAE 0W-20 ,   API SP  ").textValue, "SAE 0W-20, API SP");
  });
});

/**
 * 우리 상품의 `pattern` 칸에 규격과 하중·속도 기호가 섞여 들어간 줄이 있다.
 * 순정 타이어를 고를 때 사장님이 보시는 건 패턴명이다.
 */
describe("상품 이름에서 패턴명만 남기기", () => {
  it("앞에 붙은 규격을 뗀다", () => {
    assert.equal(cleanPattern("235/45R18 Majesty 9 Solus TA91"), "Majesty 9 Solus TA91");
    assert.equal(cleanPattern("205/55R16 Solus TA51 91H 04"), "Solus TA51");
    assert.equal(cleanPattern("245/40 ZR20 (99Y) XL TL PILOT SPORT"), "PILOT SPORT");
  });

  it("깨끗한 패턴은 그대로 둔다", () => {
    assert.equal(cleanPattern("CROSSCLIMATE 3"), "CROSSCLIMATE 3");
    assert.equal(cleanPattern("PILOT SPORT 4 SUV"), "PILOT SPORT 4 SUV");
  });

  it("🔴 못 알아보면 원래 글자를 둔다 — 지워서 빈 값을 만들지 않는다", () => {
    assert.equal(cleanPattern("235/45R18"), "235/45R18");
    assert.equal(cleanPattern(null), null);
  });
});
