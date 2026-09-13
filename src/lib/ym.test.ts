/**
 * ⭐ 달(YYYY-MM) 계산 정본(ym) — ymAdd·monthRange·pickYm·kstToday (개편 5단계 갈래 D, 2026-09-13)
 *
 *   지키는 것: 연말·연초 넘김, 여러 해 되감기, 달 경계, ?ym= 쿼리 정리(형식·미래·자료 시작 이전).
 *   🔴 「이번 달」은 Date.now() 에서 나오므로 고정값을 박지 않고 오늘 기준으로 계산해 비교한다.
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DATA_START, kstToday, monthRange, pickYm, ymAdd } from "./ym";

/** 시험이 독립적으로 구한 서울 날짜 — 구현(sv-SE)과 다른 로캘로 같은 값을 낸다 */
const seoulToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe("ymAdd — 달 더하기·빼기", () => {
  const rows: [ym: string, delta: number, expected: string, why: string][] = [
    ["2026-12", 1, "2027-01", "연말 넘김"],
    ["2026-01", -1, "2025-12", "연초 되감기"],
    ["2026-03", -15, "2024-12", "여러 해 되감기"],
    ["2026-03", 15, "2027-06", "여러 해 더하기"],
    ["2026-06", 0, "2026-06", "0 이면 그대로"],
    ["2026-06", 12, "2027-06", "12달 = 다음 해 같은 달"],
    ["2026-06", -12, "2025-06", "-12달 = 지난 해 같은 달"],
    ["2025-01", -1, "2024-12", "자료 시작 달 바로 앞"],
    ["2026-11", 2, "2027-01", "두 달 넘어 연말 지남"],
  ];
  for (const [ym, delta, expected, why] of rows) {
    test(`${why}: ymAdd(${ym}, ${delta}) = ${expected}`, () => {
      assert.equal(ymAdd(ym, delta), expected);
    });
  }

  test("달은 항상 두 자리로 나온다", () => {
    assert.match(ymAdd("2026-09", 1), /^\d{4}-\d{2}$/);
    assert.equal(ymAdd("2026-09", -8), "2026-01");
  });

  test("더했다 빼면 제자리 (2024-01 ~ 2027-12 전 구간)", () => {
    for (let y = 2024; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        for (const d of [1, 7, 13, 25]) {
          assert.equal(ymAdd(ymAdd(ym, d), -d), ym);
          assert.equal(ymAdd(ymAdd(ym, -d), d), ym);
        }
      }
    }
  });
});

describe("monthRange — [start, nextStart)", () => {
  test("2026-02 → 02-01 ~ 03-01", () => {
    assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", nextStart: "2026-03-01" });
  });
  test("12월의 다음 시작은 다음 해 1월 1일", () => {
    assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", nextStart: "2027-01-01" });
  });
  test("nextStart 는 ymAdd(+1) 과 같다", () => {
    assert.equal(monthRange("2025-07").nextStart, `${ymAdd("2025-07", 1)}-01`);
  });
});

describe("kstToday — 서울 기준 오늘", () => {
  test("YYYY-MM-DD 꼴", () => {
    assert.match(kstToday(), /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  });
  test("독립적으로 구한 서울 날짜와 같다", () => {
    assert.equal(kstToday(), seoulToday());
  });
});

describe("pickYm — ?ym= 쿼리 정리", () => {
  const thisYm = seoulToday().slice(0, 7);

  test("전제: 자료 시작 달이 이번 달보다 앞이다", () => {
    assert.ok(DATA_START <= thisYm);
    assert.match(DATA_START, /^\d{4}-(0[1-9]|1[0-2])$/);
  });

  test("정상값은 그대로 (이번 달 · 지난 달 · 자료 시작 달)", () => {
    assert.equal(pickYm(thisYm), thisYm);
    const prev = ymAdd(thisYm, -1);
    if (prev >= DATA_START) assert.equal(pickYm(prev), prev);
    assert.equal(pickYm(DATA_START), DATA_START);
  });

  test("형식이 틀리면 이번 달", () => {
    for (const bad of ["2026-1", "2026-13", "2026-00", "202601", "2026-01-01", "2026/01", " 2026-01", "abcd-ef", ""]) {
      assert.equal(pickYm(bad), thisYm, JSON.stringify(bad));
    }
  });

  test("문자열이 아니면 이번 달 (undefined · null · 숫자 · 배열 · 객체)", () => {
    for (const bad of [undefined, null, 202601, ["2026-01"], { ym: "2026-01" }, true]) {
      assert.equal(pickYm(bad), thisYm, String(bad));
    }
  });

  test("미래 달은 이번 달 — 상한은 이번 달까지(포함)", () => {
    assert.equal(pickYm(ymAdd(thisYm, 1)), thisYm);
    assert.equal(pickYm(ymAdd(thisYm, 12)), thisYm);
    assert.equal(pickYm("2999-12"), thisYm);
  });

  test("자료 시작 이전은 이번 달 — 하한은 DATA_START(포함)", () => {
    assert.equal(pickYm(ymAdd(DATA_START, -1)), thisYm);
    assert.equal(pickYm("2000-01"), thisYm);
  });
});
