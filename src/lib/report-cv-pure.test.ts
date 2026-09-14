/**
 * ⭐ 손님·차량 리포트 순수 규칙 (2026-09-14)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_BUCKETS,
  GAP_BUCKETS,
  KM_BUCKETS,
  LAPSE_BUCKETS,
  SPEND_BUCKETS,
  VISIT_BUCKETS,
  FUEL_FROM_MARS,
  asOfDate,
  bucketOf,
  daysToMonthsText,
  pickWho,
} from "./report-cv-pure";
import { FUEL_TYPES } from "./sale-types";
import { PLACEHOLDER_CUSTOMER_NAMES, isPlaceholderCustomerName } from "./normalize";

describe("pickWho — 이상한 값은 개인", () => {
  test("거래처·전체만 그대로", () => {
    assert.equal(pickWho("biz"), "biz");
    assert.equal(pickWho("all"), "all");
    assert.equal(pickWho(undefined), "person");
    assert.equal(pickWho("drop table"), "person");
    assert.equal(pickWho(["biz"]), "person");
  });
});

describe("구간 — 빈틈·겹침 없이 이어진다", () => {
  for (const [name, buckets] of Object.entries({ GAP_BUCKETS, SPEND_BUCKETS, VISIT_BUCKETS, LAPSE_BUCKETS, AGE_BUCKETS, KM_BUCKETS })) {
    test(name, () => {
      for (let i = 1; i < buckets.length; i++) assert.equal(buckets[i].lo, buckets[i - 1].hi, `${name}[${i}]`);
      assert.equal(buckets[buckets.length - 1].hi, null);
    });
  }
  test("경계값은 위 구간으로", () => {
    assert.equal(GAP_BUCKETS[bucketOf(GAP_BUCKETS, 29)].label, "1개월 안");
    assert.equal(GAP_BUCKETS[bucketOf(GAP_BUCKETS, 30)].label, "1~3개월");
    assert.equal(SPEND_BUCKETS[bucketOf(SPEND_BUCKETS, 1_000_000)].label, "100만 이상");
    assert.equal(VISIT_BUCKETS[bucketOf(VISIT_BUCKETS, 9)].label, "4번 이상");
    assert.equal(AGE_BUCKETS[bucketOf(AGE_BUCKETS, -1)].label, "3년 이하"); // 내년 연식 신차
  });
});

describe("연료 — MARS 실제 저장값을 전부 읽는다", () => {
  test("sale-types FUEL_TYPES 선택지(오타 Hybird 포함)가 매핑표에 다 있다", () => {
    for (const f of FUEL_TYPES) assert.ok(FUEL_FROM_MARS[f.value], f.value);
    assert.equal(FUEL_FROM_MARS.Hybird, "하이브리드");
  });
});

describe("자리표시 이름 — 리포트 SQL 과 매칭 판정이 같은 목록", () => {
  test("목록의 이름은 전부 자리표시로 판정", () => {
    for (const n of PLACEHOLDER_CUSTOMER_NAMES) assert.ok(isPlaceholderCustomerName(` ${n} `), n);
    assert.equal(isPlaceholderCustomerName("고태환[한진택배]"), false);
  });
});

describe("기준일", () => {
  test("이번 달이면 오늘, 지난 달이면 말일", () => {
    assert.equal(asOfDate("2026-09", "2026-09-14"), "2026-09-14");
    assert.equal(asOfDate("2026-02", "2026-09-14"), "2026-02-28");
    assert.equal(asOfDate("2024-02", "2026-09-14"), "2024-02-29");
  });
  test("날 수 → 개월 글자", () => {
    assert.equal(daysToMonthsText(null), "—");
    assert.equal(daysToMonthsText(91), "3개월");
    assert.equal(daysToMonthsText(365), "12개월");
  });
});
