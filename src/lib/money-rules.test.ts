/**
 * ⭐ 돈 규칙 점검표 (2026-08-28)
 *
 * 🔴 **왜 만들었나**
 *
 *   이 저장소에는 자동 점검이 **한 개도 없었다.** 그래서 「돈이 맞는가」를 지키는 규칙을
 *   고칠 때마다 사람 눈이 유일한 방어선이었고, 같은 종류의 실수가 이름만 바꿔 되풀이됐다 —
 *   「첫 화면 숫자 ↔ 탭 숫자 불일치」만 해도 감사 C1 → 감사 N1 → 2026-08-28 「대기」까지 세 번이다.
 *   코드 주석의 감사 번호(F1~F21 · G1~G11 · N1~N9 · R2~R9)가 사실상 테스트 대장 노릇을 하고 있었다.
 *
 *   여기 담은 넷은 전부 **사장님이 화면을 안 보셔도 앱이 스스로 돈을 잇는 근거**다:
 *     ① 여러 통장 줄을 합쳐 계산서 하나와 맞추기 (findAmountCombo/Run/BankBundle)
 *     ② 이체 수수료를 봐주는 폭            (nearTolerance)
 *     ③ 상대 이름 맞추기 ★·≈ 등급          (samePartyName / similarPartyName)
 *     ④ 「짝이 확실한 N건」에 뭐가 들어가나  (depositSurePicks)
 *   여기가 틀리면 **확인 없이 잘못 이어진다.** 그래서 여기부터 지킨다.
 *
 * 🔴 시험값은 **지어내지 않았다** — 전부 코드 주석에 남은 실제 사장님 사례다.
 *    (위즈오토·유일이엔티·진양윤활유·록산기전·양양현대자동차·타이어프로 속초점·늘푸른요양원)
 *
 * 🔴 **DB 에 접속하지 않는다.** tax-recon/recon-data 가 `@/db` 를 불러오므로 모듈이 뜨긴 하지만,
 *    postgres.js 는 질의를 던질 때만 연결한다. 여기서는 순수 계산 함수만 부른다.
 *
 *   실행:  npm test
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { DepositSuggestion } from "./recon-data";
import type { DepositTaxCands, DepositTaxBundles } from "./deposit-tax";

/* 🔴 왜 `import` 를 위에 안 쓰고 `before` 에서 불러오나 —
   tax-recon·recon-data 는 `@/db` 를 불러오고, src/db 는 DATABASE_URL 이 없으면 **모듈이 뜨는 순간**
   예외를 던진다. 그런데 `import` 문은 파일 맨 위로 끌어올려져 아래 대입문보다 **먼저** 실행된다.
   그래서 주소를 먼저 심고 나서 동적으로 불러온다. (접속은 안 한다 — postgres.js 는 질의할 때만 연결한다) */
let T: typeof import("./tax-recon");
let D: typeof import("./recon-data");
let P: typeof import("./deposit-tax");

before(async () => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
  [T, D, P] = await Promise.all([import("./tax-recon"), import("./recon-data"), import("./deposit-tax")]);
});

/* ================================================================== */
describe("① 여러 통장 줄을 합쳐 계산서 하나와 맞추기", () => {
  test("위즈오토 — 7월 계산서 1,531,222원 = 7/8 840,092 + 7/8 500,940 + 7/12 190,190", () => {
    const lines = [
      { id: 1, amount: 840_092 },
      { id: 2, amount: 500_940 },
      { id: 3, amount: 190_190 },
      { id: 4, amount: 77_000 }, // 상관없는 줄 — 안 끼어야 한다
    ];
    const got = T.findAmountCombo(lines, 1_531_222);
    assert.ok(got, "합이 딱 맞는 조합을 찾아야 한다");
    assert.deepEqual(got.map((c) => c.id).sort(), [1, 2, 3]);
  });

  test("유일이엔티 — 200원 어긋나도 허용 오차 안이면 제안하고 차이를 정직하게 남긴다", () => {
    const lines = [
      { id: 1, amount: 198_860 },
      { id: 2, amount: 2_323_200 },
    ];
    const target = 2_521_860; // 합 2,522,060 → 200원 많음
    const got = T.findAmountComboNear(lines, target, T.nearTolerance(target));
    assert.ok(got, "이체 수수료·반올림 몫은 봐줘야 한다");
    assert.equal(got.sum - target, 200);
  });

  test("차이가 허용 오차를 넘으면 조합을 만들지 않는다 (엉뚱한 추천 방지)", () => {
    const lines = [
      { id: 1, amount: 500_000 },
      { id: 2, amount: 400_000 },
    ];
    // 합 900,000 vs 계산서 800,000 → 10만원 차이. 허용 오차는 1,000원뿐
    assert.equal(T.findAmountComboNear(lines, 800_000, T.nearTolerance(800_000)), null);
  });

  test("정확히 맞는 조합이 있으면 근사보다 그것을 고른다", () => {
    const lines = [
      { id: 1, amount: 300_100 }, // 이 둘은 600,200 → 200원 많음(근사)
      { id: 2, amount: 300_100 },
      { id: 3, amount: 400_000 }, // 이 둘은 600,000 → 정확
      { id: 4, amount: 200_000 },
    ];
    const got = T.findAmountComboNear(lines, 600_000, T.nearTolerance(600_000));
    assert.ok(got);
    assert.equal(got.sum, 600_000, "정확 일치가 있으면 근사를 고르면 안 된다");
  });

  test("양양현대자동차 — 분기 합계는 날짜순으로 쭉 이어진 입금들이다 (연속 묶음)", () => {
    const runs = [
      { id: 1, amount: 100_000, date: "2025-03-24" },
      { id: 2, amount: 200_000, date: "2025-04-10" },
      { id: 3, amount: 300_000, date: "2025-05-02" },
      { id: 4, amount: 900_000, date: "2025-07-30" }, // 구간 밖
    ];
    const got = T.findAmountRun(runs, 600_000, T.nearTolerance(600_000));
    assert.ok(got);
    assert.deepEqual(got.picks.map((p) => p.id), [1, 2, 3]);
  });

  test("타이어프로 속초점 — 입금 한 줄 842,160원 = 계산서 242,160 + 600,000", () => {
    const invoices = [
      { id: 11, total: 242_160, label: "08-01 242,160원" },
      { id: 12, total: 600_000, label: "08-14 600,000원" },
    ];
    const lines = [{ id: 99, amount: 842_160, label: "★ 08-20 · 타이어프로속초 · +842,160원" }];
    const got = T.findBankBundle(invoices, lines);
    assert.ok(got);
    assert.equal(got.cashId, 99);
    assert.deepEqual(got.invoiceIds.sort(), [11, 12]);
  });

  test("통장 줄이 계산서 한 장과 정확히 맞으면 묶음으로 안 만든다 (그 장의 몫이다)", () => {
    const invoices = [
      { id: 11, total: 600_000, label: "a" },
      { id: 12, total: 242_160, label: "b" },
    ];
    const lines = [{ id: 99, amount: 600_000, label: "정확히 한 장과 같음" }];
    assert.equal(T.findBankBundle(invoices, lines), null);
  });

  test("금액이 0이거나 마이너스면 조합을 만들지 않는다", () => {
    const lines = [{ id: 1, amount: 100 }, { id: 2, amount: 200 }];
    assert.equal(T.findAmountCombo(lines, 0), null);
    assert.equal(T.findAmountCombo(lines, -300), null);
    assert.equal(T.findAmountRun([{ id: 1, amount: 100, date: "2025-01-01" }], -1, 0), null);
  });
});

/* ================================================================== */
describe("② 이체 수수료를 봐주는 폭 (1,000원 또는 0.1% 중 큰 쪽)", () => {
  test("작은 금액은 1,000원까지 봐준다", () => {
    assert.equal(T.nearTolerance(100_000), 1000);
    assert.equal(T.nearTolerance(1_000_000), 1000);
  });

  test("큰 금액은 0.1% 까지 봐준다", () => {
    assert.equal(T.nearTolerance(3_696_000), 3696);
    assert.equal(T.nearTolerance(10_000_000), 10_000);
  });

  test("진양윤활유 3,696,000 ↔ 통장 3,696,500 — BZ뱅크 수수료 500원은 봐준다", () => {
    assert.ok(Math.abs(3_696_500 - 3_696_000) <= T.nearTolerance(3_696_000));
  });

  test("록산기전 405,900 ↔ 통장 406,400 — 500원은 봐준다", () => {
    assert.ok(Math.abs(406_400 - 405_900) <= T.nearTolerance(405_900));
  });

  test("만원 넘게 어긋나면 같은 건으로 보지 않는다", () => {
    assert.ok(Math.abs(415_900 - 405_900) > T.nearTolerance(405_900));
  });

  test("마이너스 금액에도 폭은 양수다 (부호 때문에 음수가 되면 안 된다)", () => {
    assert.ok(T.nearTolerance(-3_696_000) > 0);
  });
});

/* ================================================================== */
describe("③ 상대 이름 맞추기 — ★(자동 가능) 과 ≈(사람 확인) 을 가른다", () => {
  test("표기만 다른 같은 상호는 ★ 다 — 「(주)제로」 = 「㈜제로」 (감사 G8)", () => {
    assert.equal(D.samePartyName("(주)제로", "㈜제로"), true);
    assert.equal(D.samePartyName("미쉐린코리아(주)", "미쉐린코리아"), true);
  });

  test("「김철」과 「김철수산업」은 ★ 가 아니다 — 자동으로 이으면 오연결이다 (감사 H4)", () => {
    assert.equal(D.samePartyName("김철", "김철수산업"), false);
  });

  test("「타이어」 같은 업종 일반어 하나로는 아무 데도 안 붙는다 (2025 감사 F16)", () => {
    assert.equal(D.samePartyName("타이어", "타이어365 양양점"), false);
    assert.equal(D.samePartyName("속초", "속초건설"), false);
  });

  test("「타이어프로 판교점」 ↔ 「타이어프로속초」 는 ★ 가 아니라 ≈ 다 (감사 G8 — 지점이 다르다)", () => {
    assert.equal(D.samePartyName("타이어프로 판교점", "타이어프로속초"), false);
    assert.equal(D.similarPartyName("타이어프로 판교점", "타이어프로속초"), true);
  });

  test("적요가 잘리고 괄호가 붙어도 알아본다 — 「김재준(진양윤」 ↔ 진양윤활유 (감사 R9)", () => {
    assert.equal(D.similarPartyName("김재준(진양윤", "진양윤활유"), true);
    assert.equal(D.similarPartyName("송명숙(대건종", "대건종합상사"), true);
  });

  test("지점명이 끼어도 알아본다 — 「박용익(양양점현대자」 ↔ 양양현대자동차 (2025 진행)", () => {
    assert.equal(D.similarPartyName("박용익(양양점현대자", "양양현대자동차"), true);
  });

  test("아무 상관 없는 이름은 ★ 도 ≈ 도 아니다", () => {
    assert.equal(D.samePartyName("쫑아수산", "레드캡투어"), false);
    assert.equal(D.similarPartyName("쫑아수산", "레드캡투어"), false);
  });

  test("빈 이름·한 글자는 근거가 못 된다 (통장을 통째로 긁는 사고 방지)", () => {
    assert.equal(D.samePartyName("", "진양윤활유"), false);
    assert.equal(D.samePartyName("김", "김재준"), false);
    assert.equal(D.similarPartyName(null, "진양윤활유"), false);
  });
});

/* ================================================================== */
describe("④ 「짝이 확실한 N건」에 무엇이 들어가나 — 확인 없이 자동으로 이어지는 목록", () => {
  const dep = (id: number, amount: number, payerName: string): DepositSuggestion["dep"] => ({
    id, amount, payerName,
    date: "2026-08-10", at: "08-10 11:20", description: `[BZ입금] ${payerName}`, label: "신한입금",
  });
  const quote = (quoteId: number, amount: number, nameOk: boolean) => ({
    quoteId, amount, nameOk, label: `Q${quoteId}`, date: "2026-08-10", pm: "계좌이체" as const,
  });
  const cand = (invId: number, o: Partial<DepositTaxCands[number][number]> = {}) => ({
    invId, direction: "매출" as const, label: `계산서${invId}`,
    exact: true, known: true, similar: false, remain: 320_000, ...o,
  });

  test("정확히 맞는 ★ 계산서가 딱 하나면 자동으로 잇는다", () => {
    const open = [{ dep: dep(1, 320_000, "레드캡투어"), quotes: [], parties: [], taxHint: null }];
    const cands: DepositTaxCands = { 1: [cand(50)] };
    const pick = P.depositSurePicks(open, cands);
    assert.deepEqual(pick.get(1), { kind: "tax", invId: 50 });
  });

  test("정확히 맞는 계산서가 둘이면 아무것도 자동으로 안 한다 (사장님이 고르셔야 한다)", () => {
    const open = [{ dep: dep(1, 320_000, "레드캡투어"), quotes: [], parties: [], taxHint: null }];
    const cands: DepositTaxCands = { 1: [cand(50), cand(51)] };
    assert.equal(P.depositSurePicks(open, cands).get(1), undefined);
  });

  test("늘푸른요양원 — 금액만 같은 남의 계산서(이름 다름)는 이름 맞는 판매를 밀어내지 않는다", () => {
    const open = [
      { dep: dep(1, 320_000, "늘푸른요양원"), quotes: [quote(77, 320_000, true)], parties: [], taxHint: null },
    ];
    // 금액은 같지만 상대 이름이 다른 계산서 — known=false 라 ★ 가 아니다
    const cands: DepositTaxCands = { 1: [cand(50, { known: false })] };
    assert.deepEqual(P.depositSurePicks(open, cands).get(1), { kind: "quote", quoteId: 77 });
  });

  test("이름 맞는 판매가 둘이면 자동으로 안 한다", () => {
    const open = [
      {
        dep: dep(1, 320_000, "홍길동"),
        quotes: [quote(77, 320_000, true), quote(78, 320_000, true)],
        parties: [], taxHint: null,
      },
    ];
    assert.equal(P.depositSurePicks(open, {}).get(1), undefined);
  });

  test("이름이 안 맞는 판매뿐이면 자동으로 안 한다 (동명이인·같은 금액 위험)", () => {
    const open = [
      { dep: dep(1, 320_000, "홍길동"), quotes: [quote(77, 320_000, false)], parties: [], taxHint: null },
    ];
    assert.equal(P.depositSurePicks(open, {}).get(1), undefined);
  });

  test("레드캡 — 계산서 여러 장 합이 입금과 정확히 맞으면 묶어서 잇는다", () => {
    const open = [{ dep: dep(1, 624_800, "레드캡투어"), quotes: [], parties: [], taxHint: null }];
    const bundles: DepositTaxBundles = {
      1: { invoiceIds: [60, 61], parts: ["528,000원", "96,800원"], total: 624_800, diff: 0 },
    };
    assert.deepEqual(P.depositSurePicks(open, {}, bundles).get(1), { kind: "bundle", invoiceIds: [60, 61] });
  });

  test("묶음이 금액과 딱 안 맞으면(차이 있음) 자동으로 안 한다", () => {
    const open = [{ dep: dep(1, 624_800, "레드캡투어"), quotes: [], parties: [], taxHint: null }];
    const bundles: DepositTaxBundles = {
      1: { invoiceIds: [60, 61], parts: [], total: 625_000, diff: 200 },
    };
    assert.equal(P.depositSurePicks(open, {}, bundles).get(1), undefined);
  });

  test("후보가 아예 없으면 아무것도 안 한다", () => {
    const open = [{ dep: dep(1, 100_000, "모르는사람"), quotes: [], parties: [], taxHint: null }];
    assert.equal(P.depositSurePicks(open, {}).size, 0);
  });
});
