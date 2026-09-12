/**
 * ⭐ 올린 파일이 말하는 달 (개편 4단계에서 순수 파일로, 2026-09-12)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ymsOfRows } from "./fin-upload-pure";

describe("ymsOfRows", () => {
  test("줄이 가장 많은 달이 best", () => {
    const r = ymsOfRows(["2026-08-30", "2026-09-01", "2026-09-02"], null);
    assert.equal(r.best, "2026-09");
    assert.deepEqual(r.yms, ["2026-09", "2026-08"]);
  });
  test("같은 수면 늦은 달 — 새 달을 정리하러 가는 게 자연스럽다", () => {
    const r = ymsOfRows(["2026-08-30", "2026-09-01"], null);
    assert.equal(r.best, "2026-09");
    assert.deepEqual(r.yms, ["2026-09", "2026-08"]);
  });
  test("달을 걸친 파일은 건드린 달을 다 돌려준다", () => {
    const r = ymsOfRows(["2026-07-01", "2026-08-01", "2026-08-02", "2026-09-01"], null);
    assert.deepEqual(r.yms, ["2026-08", "2026-09", "2026-07"]);
  });
  test("날짜가 하나도 없으면 fallback(조회기간)", () => {
    const r = ymsOfRows([], "2026-09-03");
    assert.equal(r.best, "2026-09");
    assert.deepEqual(r.yms, ["2026-09"]);
  });
  test("fallback 도 엉터리면 아무것도 없다", () => {
    assert.deepEqual(ymsOfRows([], null), { best: null, yms: [] });
    assert.deepEqual(ymsOfRows(["없음"], "엉터리"), { best: null, yms: [] });
  });
});
