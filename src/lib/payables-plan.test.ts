/**
 * ⭐ 거래처 축 → 출금 축 뒤집기 시험 (개편 3단계 ⑥, 2026-09-12)
 *
 *   flipExact 는 판정을 하지 않는다(exactPlan 이 정본, 시험은 payables-view.test.ts).
 *   여기서 지키는 것: 뒤집힌 모양 / 같은 인보이스가 두 출금에 안 감 / 같은 출금이 두 거래처에 안 감 / 날짜 모양.
 *
 *   실행: npm test  (DB 접속 없음)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { flipExact } from "./payables-plan";

describe("거래처 축 → 출금 축 (flipExact)", () => {
  test("거래처 카드의 exact 가 출금 한 줄씩으로 뒤집히고, 날짜는 YYYY-MM-DD 가 된다", () => {
    const r = flipExact(
      {
        콘티넨탈: { exact: [{ cashTxnId: 7, day: "08-13", amount: 2_390_300, invoiceNos: ["CO-4236", "CO-4237"] }] },
        미쉐린: { exact: [{ cashTxnId: 3, day: "08-05", amount: 1_203_048, invoiceNos: ["KR_A"] }] },
      },
      "2026-08",
    );
    assert.deepEqual(r, [
      { cashTxnId: 3, day: "2026-08-05", amount: 1_203_048, supplier: "미쉐린", invoiceNos: ["KR_A"] },
      { cashTxnId: 7, day: "2026-08-13", amount: 2_390_300, supplier: "콘티넨탈", invoiceNos: ["CO-4236", "CO-4237"] },
    ]);
  });

  test("🔴 같은 인보이스가 두 출금에 가지 않는다 — 먼저 온 출금이 갖는다", () => {
    const r = flipExact(
      { 콘티넨탈: { exact: [
        { cashTxnId: 1, day: "08-13", amount: 963_050, invoiceNos: ["CO-4236"] },
        { cashTxnId: 2, day: "08-14", amount: 2_390_300, invoiceNos: ["CO-4236", "CO-4237"] },
      ] } },
      "2026-08",
    );
    assert.deepEqual(r.map((x) => x.cashTxnId), [1]);
  });

  test("같은 출금이 두 거래처에 가지 않는다", () => {
    const r = flipExact(
      {
        A: { exact: [{ cashTxnId: 5, day: "08-01", amount: 100, invoiceNos: ["A-1"] }] },
        B: { exact: [{ cashTxnId: 5, day: "08-01", amount: 100, invoiceNos: ["B-1"] }] },
      },
      "2026-08",
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].supplier, "A");
  });

  test("exact 가 비면 빈 배열 · 같은 인보이스 번호라도 거래처가 다르면 별개다", () => {
    assert.deepEqual(flipExact({ A: { exact: [] } }, "2026-08"), []);
    const r = flipExact(
      {
        A: { exact: [{ cashTxnId: 1, day: "08-01", amount: 100, invoiceNos: ["001"] }] },
        B: { exact: [{ cashTxnId: 2, day: "08-01", amount: 100, invoiceNos: ["001"] }] },
      },
      "2026-08",
    );
    assert.equal(r.length, 2);
  });
});
