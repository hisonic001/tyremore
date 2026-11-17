/**
 * ⭐ 올린 파일이 말하는 달 (개편 4단계에서 순수 파일로, 2026-09-12)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickAccountLabel, ymsOfRows } from "./fin-upload-pure";

describe("pickAccountLabel (폴더 자동 업로드, D-41)", () => {
  const labels = ["신한입금", "신한출금", "우리카드", "신한법인카드"];
  test("파일 이름 안에 계정 이름이 통째로 — 띄어쓰기 무시", () => {
    assert.equal(pickAccountLabel("신한 입금계좌 2026Q3.xlsx", labels), "신한입금");
    assert.equal(pickAccountLabel("신한 출금 (2).xlsx", labels), "신한출금");
    assert.equal(pickAccountLabel("우리카드 2026.8.xls", labels), "우리카드");
  });
  test("모르면 null — 틀린 통장에 넣지 않는다", () => {
    assert.equal(pickAccountLabel("거래내역.xlsx", labels), null);
    assert.equal(pickAccountLabel("신한카드 법인이용내역(전체) 2026.7.xls", labels), null);
  });
  test("지정표가 먼저", () => {
    const fixed = new Map([["신한카드 법인", "신한법인카드"]]);
    assert.equal(pickAccountLabel("신한카드 법인이용내역(전체) 2026.7.xls", labels, fixed), "신한법인카드");
  });
  test("같은 길이 후보 둘이면 고르지 않는다", () => {
    assert.equal(pickAccountLabel("신한입금 신한출금 합본.xlsx", labels), null);
  });
});

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
