/**
 * ⭐ 카드 일마감 순수 함수 (개편 4단계, 2026-09-12) — 이 저장소 첫 카드 쪽 시험
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { combosSummingTo, sortOpenDays, nextOpenDay, type PosDaySummary } from "./pos-close-pure";

function day(d: string, o: Partial<PosDaySummary> = {}): PosDaySummary {
  return { day: d, posCard: 0, appCard: 0, matched: 0, open: 0, closed: false, ...o };
}

describe("combosSummingTo — 합이 맞는 조합", () => {
  test("두 개짜리", () => {
    const r = combosSummingTo([{ remain: 3 }, { remain: 7 }, { remain: 5 }], 10);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0].map((x) => x.remain).sort(), [3, 7]);
  });
  test("세 개짜리", () => {
    const r = combosSummingTo([{ remain: 1 }, { remain: 2 }, { remain: 3 }], 6);
    assert.equal(r.length, 1);
    assert.equal(r[0].length, 3);
  });
  test("답이 없으면 빈 배열", () => {
    assert.deepEqual(combosSummingTo([{ remain: 1 }, { remain: 2 }], 100), []);
  });
  test("너무 많으면 그만 센다 (애매하면 자동으로 안 쓴다)", () => {
    const many = Array.from({ length: 20 }, () => ({ remain: 5 }));
    assert.ok(combosSummingTo(many, 10).length > 8);
  });
});

describe("sortOpenDays — 오늘 먼저, 그다음 날짜 순", () => {
  const days = [day("2026-09-08"), day("2026-09-12"), day("2026-09-10", { closed: true }), day("2026-09-05")];
  test("마감된 날은 빠진다", () => {
    assert.deepEqual(sortOpenDays(days, "2026-09-12").map((d) => d.day), ["2026-09-12", "2026-09-05", "2026-09-08"]);
  });
  test("오늘이 목록에 없으면 그냥 날짜 순", () => {
    assert.deepEqual(sortOpenDays(days, "2026-09-30").map((d) => d.day), ["2026-09-05", "2026-09-08", "2026-09-12"]);
  });
  test("다 마감됐으면 빈 배열", () => {
    assert.deepEqual(sortOpenDays([day("2026-09-01", { closed: true })], "2026-09-01"), []);
  });
});

describe("nextOpenDay — 보고 있는 날 말고 다음", () => {
  const days = [day("2026-09-05"), day("2026-09-08"), day("2026-09-12")];
  test("지금 날은 건너뛴다", () => {
    assert.equal(nextOpenDay(days, "2026-09-05", "2026-09-12"), "2026-09-12", "오늘이 맨 앞");
    assert.equal(nextOpenDay(days, "2026-09-12", "2026-09-12"), "2026-09-05");
  });
  test("current 가 없으면 첫 번째 안 된 날", () => {
    assert.equal(nextOpenDay(days, null, "2026-09-30"), "2026-09-05");
  });
  test("남은 날이 없으면 null", () => {
    assert.equal(nextOpenDay([day("2026-09-05")], "2026-09-05", "2026-09-05"), null);
    assert.equal(nextOpenDay([], null, "2026-09-12"), null);
  });
});
