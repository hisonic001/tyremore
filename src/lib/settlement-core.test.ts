/**
 * ⭐ 월 정산 순수 규칙 시험 (2026-09-01)
 *   배분은 총액 불변식과 한 몸이다 — 합이 1원이라도 어긋나면 A4 감사가 울린다.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchReply, parseReplyText, planAdjustment, type OurLine } from "./settlement-core";

describe("planAdjustment — 건 합의금액을 줄 단가로 배분", () => {
  test("한 줄이면 그 줄이 통째로 받는다", () => {
    const r = planAdjustment([{ itemId: 1, qty: 1, price: 30000 }], 25000);
    assert.ok(r.ok);
    assert.deepEqual(r.changes, [{ itemId: 1, newPrice: 25000 }]);
  });

  test("여러 줄 비례 배분 — 합이 정확히 합의금액이다", () => {
    const items = [
      { itemId: 1, qty: 1, price: 45000 },
      { itemId: 2, qty: 1, price: 10000 },
      { itemId: 3, qty: 1, price: 16000 },
    ];
    const r = planAdjustment(items, 67450); // 71000 → 5% 인하
    assert.ok(r.ok);
    const prices = new Map(r.changes.map((c) => [c.itemId, c.newPrice]));
    const total = items.reduce((s, i) => s + i.qty * (prices.get(i.itemId) ?? i.price), 0);
    assert.equal(total, 67450);
  });

  test("수량 2 줄이 나머지를 못 안으면 수량 1 줄이 자투리를 안는다", () => {
    const items = [
      { itemId: 1, qty: 2, price: 20000 }, // 40,000 — 최대 줄
      { itemId: 2, qty: 1, price: 7000 },
    ];
    const r = planAdjustment(items, 46999);
    assert.ok(r.ok);
    const prices = new Map(r.changes.map((c) => [c.itemId, c.newPrice]));
    const total = items.reduce((s, i) => s + i.qty * (prices.get(i.itemId) ?? i.price), 0);
    assert.equal(total, 46999);
  });

  test("0원 줄(use)은 배분에서 빠진다", () => {
    const r = planAdjustment(
      [
        { itemId: 1, qty: 1, price: 30000 },
        { itemId: 9, qty: 1, price: 0 },
      ],
      20000,
    );
    assert.ok(r.ok);
    assert.deepEqual(r.changes, [{ itemId: 1, newPrice: 20000 }]);
  });

  test("이미 같은 금액이면 고칠 것이 없다", () => {
    const r = planAdjustment([{ itemId: 1, qty: 1, price: 30000 }], 30000);
    assert.ok(r.ok && r.changes.length === 0);
  });

  test("수량 여러 줄뿐이라 못 나누면 실패를 말한다", () => {
    const r = planAdjustment([{ itemId: 1, qty: 3, price: 10000 }], 29999);
    assert.ok(!r.ok);
  });
});

describe("parseReplyText — 회신 표 읽기", () => {
  test("우리 청구서 왕복 — 관리번호·승인금액", () => {
    const rows = parseReplyText(
      "관리번호\t작업일\t차량번호\t점검내용\t금액\t승인금액\n" +
        "Q26-0804-001\t2026-08-04\t156허2920\t엔진오일\t45000\t42750\n",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quoteNo, "Q26-0804-001");
    assert.equal(rows[0].plateNorm, "156허2920");
    assert.deepEqual(rows[0].amounts, [45000, 42750]);
  });

  test("거래처 자체 양식 — 차량번호와 금액만", () => {
    const rows = parseReplyText("149허8552 모닝  스캐너점검  10,010원  9,509원");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].plateNorm, "149허8552");
    assert.deepEqual(rows[0].amounts, [10010, 9509]);
  });

  test("머리글 줄은 걸러진다", () => {
    const rows = parseReplyText("차량번호\t점검내용\t정비금액\t승인금액");
    assert.equal(rows.length, 0);
  });
});

describe("matchReply — 회신 ↔ 우리 판매 잇기", () => {
  const ours: OurLine[] = [
    { lineId: 11, quoteId: 1, quoteNo: "Q26-0804-001", plateNorm: "156허2920", billed: 71000, workDate: "2026-08-04" },
    { lineId: 12, quoteId: 2, quoteNo: "Q26-0810-002", plateNorm: "149허8552", billed: 10010, workDate: "2026-08-10" },
    { lineId: 13, quoteId: 3, quoteNo: "Q26-0820-003", plateNorm: "149허8552", billed: 22000, workDate: "2026-08-20" },
  ];

  test("관리번호가 있으면 그걸로 (같은 차 여러 건이어도 정확)", () => {
    const m = matchReply(parseReplyText("Q26-0820-003\t149허8552\t점검\t22000\t20000"), ours, "포함");
    assert.equal(m.matched.length, 1);
    assert.equal(m.matched[0].lineId, 13);
    assert.equal(m.matched[0].matchedBy, "관리번호");
    assert.equal(m.matched[0].agreed, 20000);
  });

  test("차량 하나·판매 하나면 차량번호로", () => {
    const m = matchReply(parseReplyText("156허2920\t엔진오일 외\t71000\t65000"), ours, "포함");
    assert.equal(m.matched[0]?.lineId, 11);
    assert.equal(m.matched[0]?.matchedBy, "차량번호");
  });

  test("같은 차 두 건이면 금액으로 좁힌다", () => {
    const m = matchReply(parseReplyText("149허8552\t점검\t22000\t22000"), ours, "포함");
    assert.equal(m.matched.length, 1);
    assert.equal(m.matched[0].lineId, 13);
    assert.equal(m.matched[0].matchedBy, "차량+금액");
  });

  test("못 좁히면 자동 확정하지 않는다 (사장님 선택)", () => {
    const m = matchReply(parseReplyText("149허8552\t뭔가\t999원\t888원"), ours, "포함");
    assert.equal(m.matched.length, 0);
    assert.equal(m.ambiguous.length, 1);
    assert.equal(m.ambiguous[0].candidates.length, 2);
  });

  test("부가세 별도 업체 — ×1.1 회신은 우리 저장 기준으로 환산된다", () => {
    const m = matchReply(parseReplyText("156허2920\t점검\t78100"), ours, "별도"); // 71000×1.1
    assert.equal(m.matched.length, 1);
    assert.equal(m.matched[0].agreed, 71000);
  });

  test("차량번호 없는 이어지는 품목 줄은 직전 판매로 합산된다", () => {
    const m = matchReply(
      parseReplyText("156허2920\t엔진오일\t45000\t42750\n\t와이퍼\t10000\t9500"),
      ours,
      "포함",
    );
    assert.equal(m.matched.length, 1);
    assert.equal(m.matched[0].agreed, 42750 + 9500);
  });
});
