/** ⭐ MARS 자동 입력 작은 규칙 시험 (2026-11-18 로그 점검) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { failKey, marsNameCandidates, marsRegDate } from "./mars-fill-pure";

test("등록 날짜 — 연도만 바꾸되 오늘보다 뒤로는 안 간다", () => {
  assert.equal(marsRegDate(2014, "2026-11-18"), "2014-11-18");
  assert.equal(marsRegDate(2026, "2026-11-18"), "2026-11-18");
  assert.equal(marsRegDate(2027, "2026-11-18"), "2026-11-18"); // 2027년식 신차
});

test("고객 이름 후보 — 괄호 붙임을 뗀 이름도", () => {
  assert.deepEqual(marsNameCandidates("박준현[대순진리회]"), ["박준현[대순진리회]", "박준현"]);
  assert.deepEqual(marsNameCandidates("김철수(렌트)"), ["김철수(렌트)", "김철수"]);
  assert.deepEqual(marsNameCandidates("홍길동"), ["홍길동"]);
});

test("실패 문구 비교 키", () => {
  assert.equal(failKey("「판매 내역」을 누르지 못했습니다\n자세히"), failKey("「판매 내역」을 누르지 못했습니다 자세히"));
});
