/**
 * ⭐ 공임·정비 목록 지킴이 (2026-08-31)
 *
 *   공임 목록을 화면에서 고칠 수 있게 되면서 지켜야 할 경계선 둘:
 *
 *   ① `mars_service_no` 는 **원본 보존**(D-08) — service-catalog.ts 의 어떤 INSERT/UPDATE 도
 *      그 칸에 쓰면 안 된다. 여기서 원문을 읽어 쓰기가 없는지 확인한다.
 *   ② MARS 점검표 낱말 규칙은 `mars-service-words.ts` **정본 하나** —
 *      mars-fill.ts 가 사본 regex 를 다시 만들면 관리 화면의 미리보기와 로봇이 갈라진다.
 *
 *   그리고 낱말 규칙 자체가 뜻대로 동작하는지 (이름을 고칠 때 미리보기가 믿을 만한지).
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { replacedFromServices, replacedLabels } from "./mars-service-words";

describe("① mars_service_no 원본 보존 (D-08)", () => {
  const src = readFileSync(join(process.cwd(), "src", "lib", "service-catalog.ts"), "utf8");

  test("INSERT 칼럼 목록에 mars_service_no 가 없다", () => {
    for (const m of src.matchAll(/INSERT INTO service_item \(([^)]*)\)/g)) {
      assert.ok(!m[1].includes("mars_service_no"), "INSERT 가 mars_service_no 를 쓰고 있습니다 — MARS 원본은 손대지 않습니다");
    }
  });

  test("UPDATE SET 절에 mars_service_no 가 없다", () => {
    // UPDATE service_item ... SET ~ WHERE 사이만 본다 (SELECT 로 보여주는 것은 허용)
    for (const m of src.matchAll(/UPDATE service_item[\s\S]*?SET([\s\S]*?)WHERE/g)) {
      assert.ok(!m[1].includes("mars_service_no"), "UPDATE 가 mars_service_no 를 고치고 있습니다 — MARS 원본은 손대지 않습니다");
    }
  });
});

describe("② 낱말 규칙은 정본 하나 (mars-service-words)", () => {
  const fill = readFileSync(join(process.cwd(), "scripts", "mars-fill.ts"), "utf8");

  test("mars-fill 이 정본을 import 한다", () => {
    assert.ok(fill.includes('from "../src/lib/mars-service-words"'), "mars-fill.ts 가 mars-service-words 정본을 import 하지 않습니다");
  });

  test("mars-fill 안에 규칙 사본이 없다", () => {
    assert.ok(!fill.includes("function replacedFromServices"), "mars-fill.ts 에 replacedFromServices 사본이 다시 생겼습니다 — 정본은 src/lib/mars-service-words.ts 하나입니다");
  });
});

describe("③ 이름 → 점검표 낱말 매핑 (관리 화면 미리보기의 근거)", () => {
  test("교환은 켜진다", () => {
    const r = replacedFromServices(["엔진오일 - 국산차량", "배터리교환 - 엔진룸 내부", "휠얼라인먼트 - 국산 승용"]);
    assert.equal(r.engineOil, true);
    assert.equal(r.battery, true);
    assert.equal(r.alignment, true);
    assert.equal(r.padFront, false);
  });

  test("「점검」은 안 켜진다 — 교체가 아니다 (사장님 지시 2026-08-05)", () => {
    const r = replacedFromServices(["배터리 점검", "브레이크 디스크 점검"]);
    assert.equal(r.battery, false);
    assert.equal(r.padFront, false);
  });

  test("드럼·라이닝·슈는 후륜, 그냥 패드는 전륜", () => {
    assert.equal(replacedFromServices(["드럼교환(좌우1세트) - 허브 탈착시 추가금액"]).padRear, false); // 드럼만으론 패드 계열이 아니다
    assert.equal(replacedFromServices(["브레이크 라이닝 교환"]).padRear, true);
    assert.equal(replacedFromServices(["브레이크패드(좌우1세트) - 디스크 타입 패드 교환 - 국산"]).padFront, true);
  });

  test("미리보기 라벨 — 낱말이 빠지면 빈 배열 (화면이 경고할 근거)", () => {
    assert.deepEqual(replacedLabels("엔진오일 - 국산차량"), ["엔진오일"]);
    assert.deepEqual(replacedLabels("국산 오일"), []); // 「엔진오일」 낱말이 빠지면 점검표 체크가 꺼진다
  });
});
