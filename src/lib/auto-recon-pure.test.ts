/**
 * ⭐ 올린 자료 → 자동 대조 순서표 (개편 4단계, 2026-09-12)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { autoReconPlan, cleanYms, autoReconSummary, totalOf, ZERO_COUNTS, MAX_AUTO_YMS } from "./auto-recon-pure";

describe("autoReconPlan — 원천마다 더 할 일", () => {
  test("통장은 카드정산 → 받은 돈 → 준 돈 순서", () => {
    assert.deepEqual(autoReconPlan("통장"), ["cardSettle", "deposits", "withdrawals"]);
  });
  test("홈택스는 한 방향 파일이 와도 두 방향을 다 본다", () => {
    assert.deepEqual(autoReconPlan("홈택스매입"), ["tax:매입", "tax:매출"]);
    assert.deepEqual(autoReconPlan("홈택스매출"), ["tax:매입", "tax:매출"]);
  });
  test("이미 제 화면에서 자동으로 되는 원천은 더 할 일이 없다", () => {
    for (const s of ["법인카드", "토스포스", "카드매출승인", "카드매출입금"]) {
      assert.deepEqual(autoReconPlan(s), [], s);
    }
  });
  test("모르는 원천은 아무것도 안 한다", () => {
    assert.deepEqual(autoReconPlan(""), []);
    assert.deepEqual(autoReconPlan("엉뚱한자료"), []);
  });
});

describe("cleanYms — 달 목록 거르기", () => {
  test("형식이 맞는 것만", () => {
    assert.deepEqual(cleanYms(["2026-09", "2026-13", "26-09", "", "2026-1"]), ["2026-09"]);
  });
  test("중복을 없앤다", () => {
    assert.deepEqual(cleanYms(["2026-09", "2026-09", "2026-08"]), ["2026-09", "2026-08"]);
  });
  test(`최대 ${MAX_AUTO_YMS}개까지만 — 달을 걸친 파일이 와도 질의가 안 늘어난다`, () => {
    assert.equal(cleanYms(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]).length, MAX_AUTO_YMS);
  });
  test("비어 있거나 없으면 빈 배열", () => {
    assert.deepEqual(cleanYms(null), []);
    assert.deepEqual(cleanYms(undefined), []);
    assert.deepEqual(cleanYms([]), []);
  });
});

describe("autoReconSummary — 사장님께 보이는 한 줄", () => {
  test("0건이면 「붙일 것 없음」", () => {
    assert.equal(autoReconSummary(ZERO_COUNTS), "자동으로 붙일 것 없음");
    assert.equal(totalOf(ZERO_COUNTS), 0);
  });
  test("한 갈래뿐이면 괄호 없이", () => {
    assert.equal(autoReconSummary({ ...ZERO_COUNTS, deposits: 7 }), "자동 대조 7건");
  });
  test("여러 갈래면 0 인 것은 빼고 괄호에", () => {
    const s = autoReconSummary({ cardSettle: 0, deposits: 7, withdrawals: 3, tax: 2 });
    assert.equal(s, "자동 대조 12건 (입금 7 · 지급 3 · 계산서 2)");
    assert.ok(!s.includes("카드정산"));
  });
});
