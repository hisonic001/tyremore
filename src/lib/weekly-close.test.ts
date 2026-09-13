/**
 * ⭐ 마감 체크리스트 = 「이번 주 정리」 단계 한 벌 (개편 3단계, 2026-09-12)
 *
 *   지키는 것: hard/soft 매핑(입금·지출·계산서만 마감을 막는다), ok = !warn, posclose 항목 없음, 순서.
 *   판정 자체는 weeklySteps(DB)라 여기서 시험하지 않는다 — 나눠 담는 규칙만 본다.
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { closeChecksOf } from "./weekly-close";
import type { WeeklySteps } from "./weekly-steps";
import type { CloseCheck } from "./month-close";

function fake(warns: Partial<Record<string, boolean>>): WeeklySteps {
  const keys = ["upload", "card", "deposits", "expenses", "tax", "payables", "close"] as const;
  return {
    ym: "2026-08",
    steps: keys.map((key, i) => ({
      key,
      no: i + 1,
      title: key,
      status: `${key}-상태`,
      href: `/finance/${key}?ym=2026-08`,
      warn: warns[key] ?? false,
      remain: warns[key] ? 1 : 0,
    })),
    done: 0,
    total: 7,
  };
}
const health: CloseCheck = { key: "health", ok: true, text: "자료 검증 ✓", href: "/finance?ym=2026-08" };

describe("closeChecksOf — 단계 한 벌에서 마감 체크리스트", () => {
  test("입금·지출·계산서만 hard, 나머지는 soft", () => {
    const r = closeChecksOf(fake({}), { zero: null, health });
    const soft = Object.fromEntries(r.map((c) => [c.key, !!c.soft]));
    assert.equal(soft.deposits, false);
    assert.equal(soft.expenses, false);
    assert.equal(soft.tax, false);
    assert.equal(soft.upload, true);
    assert.equal(soft.card, true);
    assert.equal(soft.payables, true);
  });

  test("ok 는 단계의 warn 을 뒤집은 것, 글자는 단계 status 그대로", () => {
    const r = closeChecksOf(fake({ deposits: true, card: true }), { zero: null, health });
    const by = Object.fromEntries(r.map((c) => [c.key, c]));
    assert.equal(by.deposits.ok, false);
    assert.equal(by.card.ok, false);
    assert.equal(by.expenses.ok, true);
    assert.equal(by.deposits.text, "deposits-상태");
    assert.equal(by.deposits.href, "/finance/deposits?ym=2026-08");
  });

  test("posclose·close 항목은 없고, 순서는 단계 순 → zero → health → audit", () => {
    const zero: CloseCheck = { key: "zero", ok: false, soft: true, text: "금액 없는 매입 1건", href: "/receiving" };
    const audit: CloseCheck = { key: "audit", ok: false, soft: true, text: "정합성 이상 2가지", href: "/finance/ledger?ym=2026-08#audit" };
    const r = closeChecksOf(fake({}), { zero, health, audit });
    assert.deepEqual(
      r.map((c) => c.key),
      ["upload", "card", "deposits", "expenses", "tax", "payables", "zero", "health", "audit"],
    );
    assert.ok(!r.some((c) => (c.key as string) === "posclose"));
    assert.ok(!r.some((c) => (c.key as string) === "close"));
  });

  test("zero·audit 가 없으면 빠진다", () => {
    const r = closeChecksOf(fake({}), { zero: null, health });
    assert.equal(r.length, 7);
    assert.equal(r[r.length - 1].key, "health");
  });

  test("정합성(audit)은 soft — 이상이 있어도 hard 항목은 그대로", () => {
    const audit: CloseCheck = { key: "audit", ok: false, soft: true, text: "정합성 이상 1가지", href: "/finance/ledger#audit" };
    const r = closeChecksOf(fake({}), { zero: null, health, audit });
    assert.equal(r.length, 8);
    assert.equal(r[r.length - 1].key, "audit");
    assert.equal(r[r.length - 1].soft, true);
    assert.ok(r.filter((c) => !c.soft).every((c) => c.ok), "hard 항목은 전부 ok — audit 이 마감을 막지 않는다");
  });
});
