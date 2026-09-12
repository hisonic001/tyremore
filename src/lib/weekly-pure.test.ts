/**
 * ⭐ parseStep — /finance/weekly?step=N 의 기본값 규칙 (개편 3단계, 2026-09-12)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseStep, remainingSteps, stepMark } from "./weekly-pure";
import type { WeeklyStep } from "./weekly-steps";

function steps(flags: { warn?: boolean; idle?: boolean }[]): WeeklyStep[] {
  const keys = ["upload", "card", "deposits", "expenses", "tax", "payables", "close"] as const;
  return keys.map((key, i) => ({
    key,
    no: i + 1,
    title: key,
    status: "",
    href: "/",
    warn: flags[i]?.warn ?? false,
    idle: flags[i]?.idle,
    remain: null,
  }));
}

describe("parseStep", () => {
  test("1~7 정수면 그대로", () => {
    const s = steps([{ warn: true }, {}, {}, {}, {}, {}, {}]);
    assert.equal(parseStep("3", s), 3);
    assert.equal(parseStep("7", s), 7);
    assert.equal(parseStep("1", s), 1);
  });
  test("없거나 범위 밖이면 첫 미완 단계", () => {
    const s = steps([{}, {}, { warn: true }, { warn: true }, {}, {}, { warn: true, idle: true }]);
    assert.equal(parseStep(undefined, s), 3);
    assert.equal(parseStep("0", s), 3);
    assert.equal(parseStep("8", s), 3);
    assert.equal(parseStep("abc", s), 3);
    assert.equal(parseStep(["3"], s), 3, "배열이면 문자열이 아니라 기본값");
  });
  test("idle(때 아님)은 미완으로 세지 않는다", () => {
    const s = steps([{}, {}, {}, {}, {}, {}, { warn: true, idle: true }]);
    assert.equal(parseStep(undefined, s), 7, "남은 게 없으면 마지막 단계");
  });
  test("다 끝났으면 마지막 단계(정리 끝 단추가 거기)", () => {
    assert.equal(parseStep(undefined, steps([])), 7);
    assert.equal(parseStep(undefined, steps([{}, {}, {}, {}, {}, {}, {}])), 7);
  });
});

describe("remainingSteps · stepMark", () => {
  test("남은 단계 = warn && !idle", () => {
    assert.equal(remainingSteps(steps([{ warn: true }, {}, { warn: true }, {}, {}, {}, { warn: true, idle: true }])), 2);
  });
  test("동그라미 숫자", () => {
    assert.equal(stepMark(1), "①");
    assert.equal(stepMark(7), "⑦");
    assert.equal(stepMark(9), "9");
  });
});
