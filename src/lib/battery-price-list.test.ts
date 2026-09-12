import { test } from "node:test";
import assert from "node:assert/strict";
import { BATTERY_BRANDS, BATTERY_PRICES } from "./battery-price-list";

/**
 * 단가표는 사진을 손으로 옮긴 자료라 조용한 실수가 들어가기 쉽다.
 * 다음 인상표를 옮겨 적을 때 이 셋이 지켜지는지만 기계가 본다.
 */

test("품명이 겹치지 않는다 — 겹치면 스크립트가 뒤엣것으로 조용히 덮어쓴다", () => {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of BATTERY_PRICES) {
    if (seen.has(r.name)) dups.push(r.name);
    seen.add(r.name);
  }
  assert.deepEqual(dups, []);
});

test("브랜드는 화면 탭에 있는 것만 — 없는 브랜드는 화면에서 사라진다", () => {
  const bad = BATTERY_PRICES.filter((r) => !(BATTERY_BRANDS as readonly string[]).includes(r.brand));
  assert.deepEqual(bad.map((r) => `${r.brand} ${r.name}`), []);
});

test("값은 양수이거나 null(사진에서 안 읽힘) — 0원·음수는 실수다", () => {
  const bad = BATTERY_PRICES.filter((r) => r.price !== null && !(Number.isInteger(r.price) && r.price > 0));
  assert.deepEqual(bad.map((r) => `${r.name} ${r.price}`), []);
});

test("엑스프로 XP 는 안 넣는다 (사장님 결정 2026-09-12)", () => {
  const xp = BATTERY_PRICES.filter((r) => /^X[PT]/.test(r.name));
  assert.deepEqual(xp.map((r) => r.name), []);
});

test("값이 없는 줄에는 왜 없는지 메모가 있다", () => {
  const noNote = BATTERY_PRICES.filter((r) => r.price === null && !r.note);
  assert.deepEqual(noNote.map((r) => r.name), []);
});
