import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SPEC_ITEMS } from "./spec-core";
import {
  buildSpecSheet,
  collapseValues,
  fuelOf,
  shortQualifier,
  setTitle,
  topicOf,
  topicOfCategory,
  TOPIC_ORDER,
  worstOf,
  type SheetInput,
  type SheetPart,
} from "./spec-sheet-core";

/** 시험을 짧게 쓰려고 — 실제 자료와 같은 모양이다 */
let nextId = 1;
function row(over: Partial<SheetInput> & { item: string }): SheetInput {
  return {
    id: nextId++,
    label: over.label ?? over.item,
    shown: "값",
    hidden: false,
    qualifier: null,
    groupNo: 1,
    groupLabel: null,
    status: "자동확인",
    ...over,
  };
}

function part(over: Partial<SheetPart> & { category: string }): SheetPart {
  return {
    productId: nextId++,
    name: "부품",
    partNo: null,
    oemNos: [],
    engine: null,
    axle: null,
    inch: null,
    why: "근거",
    listPrice: null,
    stock: 0,
    ...over,
  };
}

describe("항목을 주제로 나누기", () => {
  it("🔴 제원 항목 19종이 빠짐없이 어느 주제엔가 들어간다", () => {
    for (const it of SPEC_ITEMS) {
      assert.ok(TOPIC_ORDER.includes(topicOf(it.key)), `${it.key} 가 갈 곳이 없다`);
    }
  });

  it("🔴 모르는 항목도 버리지 않는다 — 항목이 늘어도 값이 안 사라진다", () => {
    assert.equal(topicOf("brake_disc_thickness"), "그밖에");
    assert.equal(topicOfCategory(null), "경정비");
    assert.equal(topicOfCategory("듣도보도못한갈래"), "경정비");
  });

  it("배터리는 배터리로, 필터는 경정비로", () => {
    assert.equal(topicOfCategory("배터리"), "배터리");
    assert.equal(topicOfCategory("오일필터"), "경정비");
    assert.equal(topicOf("tire_pressure"), "타이어");
    assert.equal(topicOf("engine_oil_qty"), "경정비");
  });
});

describe("한 장으로 묶기", () => {
  it("🔴 어떤 값도 사라지지 않는다", () => {
    const rows = [
      row({ item: "tire_size", shown: "235/60R18" }),
      row({ item: "engine_oil_qty", shown: "5.3 L" }),
      row({ item: "battery_ah", shown: "70 Ah" }),
      row({ item: "wiper_size", shown: "650 mm" }),
      row({ item: "듣도보도못한항목", shown: "무엇" }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토 MQ4", variantKey: "MQ4", rows });
    assert.equal(sheet.dropped, 0, "어느 주제에도 못 들어간 값이 있으면 안 된다");
    const lines = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).filter((l) => l.kind === "값");
    assert.equal(lines.length, 5);
  });

  it("🔴 타이어와 엔진오일이 같은 벌 번호여도 다른 카드로 갈린다", () => {
    /* DB 에 실제로 이렇게 들어 있다 — parseTireWheelTable 과 parseOilTable 이 각자 1번을 매긴다 */
    const rows = [
      row({ item: "tire_size", shown: "235/60R18", groupNo: 1, groupLabel: "235/60R18" }),
      row({ item: "engine_oil_qty", shown: "5.3 L", groupNo: 1, groupLabel: "가솔린 2.5" }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows });
    const 타이어 = sheet.topics.find((t) => t.key === "타이어")!;
    const 경정비 = sheet.topics.find((t) => t.key === "경정비")!;
    assert.ok(타이어.sets.some((s) => s.lines.some((l) => l.item === "tire_size")));
    assert.ok(경정비.sets.some((s) => s.lines.some((l) => l.item === "engine_oil_qty")));
    assert.ok(
      !타이어.sets.some((s) => s.lines.some((l) => l.item === "engine_oil_qty")),
      "타이어 카드에 엔진오일이 들어가면 안 된다 — 이게 지금 화면의 병이다",
    );
  });

  it("🔴 벌이 둘이면 둘 다 나온다 — 18인치 차가 19인치 값을 보면 안 된다", () => {
    const rows = [
      row({ item: "tire_size", shown: "235/60R18", groupNo: 1, groupLabel: "235/60R18" }),
      row({ item: "wheel_nut_torque", shown: "11 kgf·m", groupNo: 1 }),
      row({ item: "tire_size", shown: "255/45R20", groupNo: 2, groupLabel: "255/45R20" }),
      row({ item: "wheel_nut_torque", shown: "11 kgf·m", groupNo: 2 }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows });
    assert.equal(sheet.setCount, 2);
    const 타이어 = sheet.topics.find((t) => t.key === "타이어")!;
    assert.equal(타이어.sets.length, 2);
    assert.equal(타이어.sets[0].title, "235/60R18");
    assert.equal(타이어.sets[1].title, "255/45R20");
  });

  it("🔴 오일 값이 벌마다 다르면 하나 고르지 않고 어긋났다고 한다", () => {
    const rows = [
      row({ item: "engine_oil_qty", shown: "5.3 L", groupNo: 1 }),
      row({ item: "engine_oil_qty", shown: "6.0 L", groupNo: 2 }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows });
    const line = sheet.topics
      .flatMap((t) => t.sets.flatMap((s) => s.lines))
      .find((l) => l.item === "engine_oil_qty")!;
    assert.equal(line.conflict, true, "조용히 접히면 엔진이 상한다");
    assert.equal(line.values.length, 2, "두 값을 다 남겨야 사장님이 고르신다");
  });

  it("조건이 달라서 갈린 것은 어긋남이 아니다 — 가솔린 5.3 · 디젤 6.0", () => {
    const rows = [
      row({ item: "engine_oil_qty", shown: "5.3 L", qualifier: "가솔린", groupNo: 1 }),
      row({ item: "engine_oil_qty", shown: "6.0 L", qualifier: "디젤", groupNo: 2 }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows });
    const line = sheet.topics
      .flatMap((t) => t.sets.flatMap((s) => s.lines))
      .find((l) => l.item === "engine_oil_qty")!;
    assert.equal(line.conflict, false);
  });

  it("🔴 확인 전 위험값은 숫자가 새지 않는다", () => {
    const rows = [row({ item: "wheel_nut_torque", shown: null, hidden: true, status: "검수대기" })];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows });
    const values = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines.flatMap((l) => l.values)));
    for (const v of values) assert.equal(v.shown, null, "숨겨야 할 값이 화면 자료에 들어 있다");
    assert.ok(values.every((v) => v.hidden));
  });

  it("있어야 하는데 없는 것은 「없음」 줄로 보인다", () => {
    const sheet = buildSpecSheet({ label: "포터2", variantKey: "HR", rows: [] });
    const 없음 = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).filter((l) => l.kind === "없음");
    assert.ok(없음.some((l) => l.item === "tire_size"), "타이어 규격이 없다는 것도 한눈에 보여야 한다");
    assert.ok(없음.some((l) => l.item === "wiper_size"));
  });
});

describe("같은 값 접기", () => {
  const v = (shown: string, qualifier: string | null) => ({
    shown,
    hidden: false,
    locked: false,
    qualifier,
    status: "자동확인" as const,
    specId: 1,
  });

  it("앞뒤가 같으면 한 줄로 접는다", () => {
    const got = collapseValues([v("230 kPa (33 psi)", "앞"), v("230 kPa (33 psi)", "뒤")]);
    assert.equal(got.values.length, 1);
    assert.equal(got.values[0].qualifier, null);
    assert.equal(got.values[0].shown, "230 kPa (33 psi)", "글자를 손대면 원문과 달라 보인다");
  });

  it("앞뒤가 다르면 둘 다 남긴다", () => {
    const got = collapseValues([v("230 kPa", "앞"), v("260 kPa", "뒤")]);
    assert.equal(got.values.length, 2);
    assert.equal(got.values[0].qualifier, "앞");
  });
});

describe("벌 이름", () => {
  it("원래 이름이 있으면 그대로", () => {
    const rows = [row({ item: "tire_size", groupNo: 3, groupLabel: "19인치 (앞 245/45R19 · 뒤 275/40R19)" })];
    assert.equal(setTitle(rows, 3), "19인치 (앞 245/45R19 · 뒤 275/40R19)");
  });

  it("이름이 없으면 타이어 규격에서 인치를 뽑는다", () => {
    const rows = [row({ item: "tire_size", shown: "235/60R18", groupNo: 4, groupLabel: null })];
    assert.equal(setTitle(rows, 4), "18인치");
  });
});

describe("가장 덜 확인된 상태", () => {
  it("검수대기가 자동확인을 이긴다 — 배지는 약한 값을 따라간다", () => {
    assert.equal(worstOf(["승인", "자동확인"]), "자동확인");
    assert.equal(worstOf(["자동확인", "검수대기"]), "검수대기");
    assert.equal(worstOf(["승인", "승인"]), "승인");
    assert.equal(worstOf([null, null]), null);
  });
});

/**
 * 🔴 사장님 지시: 「부품은 정확하게 그 차량에 적합한 것이 들어가야 한다.」
 *    엔진을 안 고르셨으면 하나로 좁히면 안 된다.
 */
describe("엔진과 부품", () => {
  const parts = [
    part({ category: "오일필터", name: "디젤용", oemNos: ["26320-2R000"], engine: "2.2 디젤" }),
    part({ category: "오일필터", name: "가솔린용", oemNos: ["26350-2S000"], engine: "2.5 가솔린" }),
    part({ category: "오일필터", name: "모름", oemNos: ["26350-2J000"], engine: null }),
  ];

  it("차종에 있는 엔진 후보를 모은다", () => {
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows: [], parts });
    /* 🔴 연료 수준으로 묶는다 — 사장님이 아시는 것은 「디젤이냐 가솔린이냐」다 */
    assert.deepEqual(sheet.engines, ["디젤", "가솔린"]);
    assert.equal(sheet.engine, null, "안 고르셨으면 고른 게 없다");
  });

  it("🔴 엔진을 안 골랐으면 후보를 하나로 좁히지 않는다", () => {
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows: [], parts });
    const 부품줄 = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).filter((l) => l.kind === "부품");
    assert.equal(부품줄.length, 3, "셋 다 보여 드리고 사장님이 고르셔야 한다");
  });

  it("엔진을 고르면 그 엔진 것과 조건 모를 것만 남는다", () => {
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows: [], parts, engine: "디젤" });
    const 부품줄 = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).filter((l) => l.kind === "부품");
    const names = 부품줄.map((l) => l.part!.name).sort();
    assert.deepEqual(names, ["디젤용", "모름"].sort());
    assert.ok(!names.includes("가솔린용"), "다른 엔진 것을 권하면 안 된다");
  });

  it("🔴 조건을 못 읽은 부품이 있으면 화면이 알 수 있어야 한다", () => {
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows: [], parts });
    const 경정비 = sheet.topics.find((t) => t.key === "경정비")!;
    assert.equal(경정비.needsPick, true);
    assert.equal(경정비.origin, "부품", "부품에서만 온 주제는 승인할 제원 값이 없다");
  });

  it("없는 엔진을 고르면 무시한다 — 잘못된 좁히기를 하지 않는다", () => {
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows: [], parts, engine: "LPG" });
    assert.equal(sheet.engine, null);
    const 부품줄 = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).filter((l) => l.kind === "부품");
    assert.equal(부품줄.length, 3);
  });
});

/**
 * 🔴 사장님이 아시는 것은 「디젤이냐 가솔린이냐 하이브리드냐」다.
 *    부품 글 그대로 두면 칩이 [1.6 하이브리드][2.2 디젤][2.5][디젤][하이브리드] 다섯이 된다 —
 *    2026-09-05 에 실제 화면에서 그랬다.
 */
describe("엔진을 연료 수준으로 묶기", () => {
  it("여러 모양을 하나로 모은다", () => {
    assert.equal(fuelOf("2.2 디젤"), "디젤");
    assert.equal(fuelOf("디젤 엔진 스마트스트림 D2.2"), "디젤");
    assert.equal(fuelOf("1.6 하이브리드"), "하이브리드");
    assert.equal(fuelOf("가솔린 엔진 스마트스트림 G2.5 T-GDi"), "가솔린");
    assert.equal(fuelOf("2.5"), null, "배기량만으로는 연료를 모른다");
    assert.equal(fuelOf(null), null);
  });

  it("「가솔린 하이브리드」는 하이브리드다 — 좁은 말이 이긴다", () => {
    assert.equal(fuelOf("투싼 NX4 가솔린 하이브리드"), "하이브리드");
  });

  it("칩은 셋이어야 한다", () => {
    const parts = [
      part({ category: "오일필터", engine: "2.2 디젤" }),
      part({ category: "오일필터", engine: "디젤" }),
      part({ category: "에어필터", engine: "1.6 하이브리드" }),
      part({ category: "오일필터", engine: "2.5" }),
    ];
    const rows = [row({ item: "engine_oil_qty", qualifier: "가솔린 엔진 스마트스트림 G2.5 T-GDi" })];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows, parts });
    assert.deepEqual(sheet.engines, ["디젤", "가솔린", "하이브리드"]);
  });

  it("🔴 엔진을 고르면 제원 값도 같이 좁혀진다", () => {
    const rows = [
      row({ item: "engine_oil_qty", shown: "5.6 L", qualifier: "디젤 엔진 스마트스트림 D2.2", groupNo: 1 }),
      row({ item: "engine_oil_qty", shown: "5.8 L", qualifier: "가솔린 엔진 스마트스트림 G2.5", groupNo: 2 }),
      row({ item: "brake_fluid_spec", shown: "DOT-4", qualifier: null, groupNo: 1 }),
    ];
    const sheet = buildSpecSheet({ label: "쏘렌토", variantKey: "MQ4", rows, engine: "디젤" });
    const oil = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).find((l) => l.item === "engine_oil_qty")!;
    assert.equal(oil.values.length, 1);
    assert.equal(oil.values[0].shown, "5.6 L");
    /* 🔴 연료가 안 적힌 값은 남긴다 — 모든 엔진에 해당할 수 있다 */
    const brake = sheet.topics.flatMap((t) => t.sets.flatMap((s) => s.lines)).find((l) => l.item === "brake_fluid_spec");
    assert.ok(brake, "연료가 안 적힌 값을 지우면 안 된다");
  });
});

describe("조건표를 짧게", () => {
  it("긴 엔진 이름을 줄이되 원래 뜻은 남긴다", () => {
    assert.equal(shortQualifier("디젤 엔진 스마트스트림 D2.2"), "디젤 2.2");
    assert.equal(shortQualifier("가솔린 엔진 스마트스트림 G2.5 T-GDi"), "가솔린 2.5");
  });

  it("짧은 것은 그대로 둔다", () => {
    assert.equal(shortQualifier("앞"), "앞");
    assert.equal(shortQualifier("기어유"), "기어유");
    assert.equal(shortQualifier(null), null);
  });
});
