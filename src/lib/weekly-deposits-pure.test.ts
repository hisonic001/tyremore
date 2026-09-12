/**
 * ⭐ ③ 입금 대조 3층 나누기 시험 (개편 3단계, 2026-09-12)
 *
 *   partitionDeposits 는 판정을 하지 않는다 — 정본이 낸 후보 수만 세어 층에 담는다.
 *   여기서 지키는 것: 확실은 무조건 확실층 / 후보 딱 1개만 확인층 / 나머지는 손층, 한 입금은 한 층에만.
 *
 *   실행: npm test  (DB 접속 없음 — 이 파일은 type import 뿐)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { DepositSuggestion } from "./recon-data";
import type { DepositTaxBundles, DepositTaxCands } from "./deposit-tax";
import { partitionDeposits } from "./weekly-deposits-pure";

const dep = (id: number, opts: { quotes?: number; parties?: number } = {}): DepositSuggestion => ({
  dep: { id, date: "2026-09-01", at: "09-01", amount: 100_000, description: `[이체] 손님${id}`, payerName: `손님${id}`, label: "" },
  quotes: Array.from({ length: opts.quotes ?? 0 }, (_, i) => ({
    quoteId: id * 10 + i, label: "", amount: 100_000, date: "2026-09-01", pm: "계좌이체", nameOk: true,
  })),
  parties: Array.from({ length: opts.parties ?? 0 }, (_, i) => ({ key: `C:${id * 10 + i}`, label: "", remain: 100_000, count: 1 })),
  taxHint: null,
});
const cand = (invId: number) => ({ invId, direction: "매출" as const, label: "", exact: true, known: true, similar: false, remain: 100_000 });

describe("③ 입금 대조 — 3층 나누기 (partitionDeposits)", () => {
  test("네 층이 갈린다 — 확실 / 확인(묶음·계산서 1·판매 1) / 손(후보 여럿·없음·미수금만)", () => {
    const open = [
      dep(1, { quotes: 1 }), // 확실 (sureIds)
      dep(2), // 확인 — 묶음
      dep(3), // 확인 — 계산서 후보 1
      dep(4, { quotes: 1 }), // 확인 — 판매 1 ∧ 계산서 0
      dep(5), // 손 — 계산서 후보 2
      /* 확인 — 판매 1 ∧ 계산서 1: 규칙(계획서 §2 ③)은 「계산서 후보 1」이면 판매 후보 수와 무관하게 확인층
         (계산서가 우선 후보 — 아래 4번째 시험과 같은 규칙). 2026-09-12 정정: 처음 기대값이 「손」이라 실패했다 */
      dep(6, { quotes: 1 }),
      dep(7, { quotes: 2 }), // 손 — 판매 2
      dep(8, { parties: 1 }), // 손 — 미수금 후보만 (수금은 손으로)
      dep(9), // 손 — 후보 없음
      dep(10, { quotes: 1 }), // 손 — 판매 1 인데 계산서가 2 (어느 계산서인지 사람이 골라야)
    ];
    const taxCands: DepositTaxCands = { 3: [cand(31)], 5: [cand(51), cand(52)], 6: [cand(61)], 10: [cand(101), cand(102)] };
    const bundles: DepositTaxBundles = { 2: { invoiceIds: [21, 22], parts: [], total: 100_000, diff: 0 } };
    const r = partitionDeposits(open, taxCands, bundles, [1]);
    assert.deepEqual(r.sure, [1]);
    assert.deepEqual(r.check.map((s) => s.dep.id), [2, 3, 4, 6]);
    assert.deepEqual(r.hand.map((s) => s.dep.id), [5, 7, 8, 9, 10]);
  });

  test("확실이면 후보가 몇 개든 확실층 하나에만 — 두 층에 겹치지 않는다", () => {
    const open = [dep(1, { quotes: 1 }), dep(2)];
    const r = partitionDeposits(open, { 1: [cand(11)] }, {}, [1, 2]);
    assert.deepEqual(r.sure, [1, 2]);
    assert.equal(r.check.length + r.hand.length, 0);
  });

  test("sureIds 에 open 에 없는 id 가 섞여 있어도 버린다 (화면 목록을 믿지 않는다)", () => {
    const r = partitionDeposits([dep(1)], {}, {}, [999, 1]);
    assert.deepEqual(r.sure, [1]);
    assert.deepEqual(r.hand.map((s) => s.dep.id), []);
  });

  test("계산서 후보 1 이면 판매 후보가 몇이든 확인층 (계산서가 우선 후보)", () => {
    const r = partitionDeposits([dep(1, { quotes: 3 })], { 1: [cand(11)] }, {}, []);
    assert.equal(r.check.length, 1);
    assert.equal(r.hand.length, 0);
  });
});
