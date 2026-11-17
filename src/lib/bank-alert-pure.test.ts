/**
 * ⭐ 신한 SOL Biz 입출금 알림 읽기 + 통장 파일 줄과 짝짓기 (2026-11-17)
 *   알림 문구는 사장님 폰 캡처(2026-11-17) 그대로.
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { alertDedupKey, matchAlertToStatement, parseAccountMap, parseBankAlert, type CashLineLite } from "./bank-alert-pure";

const NOW = new Date("2026-11-17T02:40:00Z"); // KST 11:40

describe("parseBankAlert", () => {
  test("펼친 알림 — 금액·시각·계좌표·상대·잔액", () => {
    const a = parseBankAlert("입출금 안내\n입금 1,660,680원 11/17 10:34\n입금(1210) ← 현240991175\n잔액 9,639,873원", NOW);
    assert.deepEqual(a, {
      direction: "입금",
      amount: 1660680,
      occurredAt: "2026-11-17 10:34:00",
      accountTag: "1210",
      accountName: "입금",
      counterparty: "현240991175",
      balance: 9639873,
    });
  });
  test("실물 출금 (2026-11-17 12:55) — 둘째 줄 「입금(1210)」은 통장 별명, 상대의 「(주)」는 계좌가 아니다", () => {
    const a = parseBankAlert("입출금 안내\n출금 9,768,703원 11/17 12:55\n입금(1210) → (주)싸이오토모\n잔액 0원", NOW);
    assert.deepEqual(a, {
      direction: "출금",
      amount: 9768703,
      occurredAt: "2026-11-17 12:55:00",
      accountTag: "1210",
      accountName: "입금",
      counterparty: "(주)싸이오토모",
      balance: 0,
    });
  });
  test("별명이 「입금」「출금」이 아니어도 계좌 숫자를 읽는다", () => {
    const a = parseBankAlert("입금 9,768,703원 11/17 12:55\n주거래(5678) ← (주)싸이오토모\n잔액 12,000,000원", NOW);
    assert.equal(a?.accountTag, "5678");
    assert.equal(a?.accountName, "주거래");
    assert.equal(a?.counterparty, "(주)싸이오토모");
  });
  test("한 줄로 이어 붙어 와도 읽는다", () => {
    const a = parseBankAlert("입출금 안내 입금 128,830원 11/17 11:36 입금(1210) ← 하나92226127 잔액 9,768,703원", NOW);
    assert.equal(a?.amount, 128830);
    assert.equal(a?.counterparty, "하나92226127");
    assert.equal(a?.balance, 9768703);
  });
  test("접혀서 잘린 알림 — 금액·날짜만 있어도 받고 잔액은 null", () => {
    const a = parseBankAlert("입출금 안내\n입금 350,000원 11/17\n09:28...", NOW);
    assert.equal(a?.amount, 350000);
    assert.equal(a?.occurredAt, "2026-11-17 09:28:00");
    assert.equal(a?.balance, null);
  });
  test("잘린 상대 이름의 「...」는 떼어 낸다", () => {
    const a = parseBankAlert("입금 29,656원 11/17 10:20\n입금(1210) ← 롯데99362...", NOW);
    assert.equal(a?.counterparty, "롯데99362");
  });
  test("출금", () => {
    const a = parseBankAlert("입출금 안내\n출금 50,000원 11/17 12:01\n출금(5678) → 홍길동\n잔액 1,000원", NOW);
    assert.equal(a?.direction, "출금");
    assert.equal(a?.accountTag, "5678");
    assert.equal(a?.counterparty, "홍길동");
  });
  test("1월에 받은 12월 알림은 작년", () => {
    const a = parseBankAlert("입금 1,000원 12/31 23:59", new Date("2026-01-01T00:10:00Z"));
    assert.equal(a?.occurredAt, "2025-12-31 23:59:00");
  });
  test("은행 알림이 아니면 null", () => {
    assert.equal(parseBankAlert("광고: 이벤트 참여하세요", NOW), null);
  });
});

describe("parseAccountMap / alertDedupKey", () => {
  test("계좌표 → 계정 이름", () => {
    const m = parseAccountMap("1210=신한입금; 5678=신한출금");
    assert.equal(m.get("1210"), "신한입금");
    assert.equal(m.get("5678"), "신한출금");
  });
  test("잔액이 있으면 잔액으로 가른다 — 같은 알림이 두 번 와도 한 줄", () => {
    const a = parseBankAlert("입금 1,660,680원 11/17 10:34\n입금(1210) ← 현240991175\n잔액 9,639,873원", NOW)!;
    assert.equal(alertDedupKey("신한입금", a), "알림|신한입금|1660680|0|9639873");
  });
});

describe("matchAlertToStatement", () => {
  const al = (id: number, at: string, inA: number, bal: number | null): CashLineLite => ({ id, occurredAt: at, inAmount: inA, outAmount: 0, balance: bal });
  test("금액·잔액이 같으면 짝 (초 단위 차이·알림 지연 무시)", () => {
    const stmt = al(0, "2026-11-17 10:34:27", 1660680, 9639873);
    assert.equal(matchAlertToStatement(stmt, [al(7, "2026-11-17 10:34:00", 1660680, 9639873)], new Set()), 7);
  });
  test("잔액이 다르면 짝이 아니다", () => {
    const stmt = al(0, "2026-11-17 10:34:27", 1660680, 9639873);
    assert.equal(matchAlertToStatement(stmt, [al(7, "2026-11-17 10:34:00", 1660680, 1)], new Set()), null);
  });
  test("잔액 없는 알림 — 5분 안 같은 금액이 하나뿐일 때만", () => {
    const stmt = al(0, "2026-11-17 09:28:40", 350000, 5000000);
    assert.equal(matchAlertToStatement(stmt, [al(3, "2026-11-17 09:28:00", 350000, null)], new Set()), 3);
    assert.equal(
      matchAlertToStatement(stmt, [al(3, "2026-11-17 09:28:00", 350000, null), al(4, "2026-11-17 09:29:00", 350000, null)], new Set()),
      null,
    );
  });
  test("이미 짝지은 알림은 다시 안 쓴다", () => {
    const stmt = al(0, "2026-11-17 10:34:27", 1660680, 9639873);
    assert.equal(matchAlertToStatement(stmt, [al(7, "2026-11-17 10:34:00", 1660680, 9639873)], new Set([7])), null);
  });
});
