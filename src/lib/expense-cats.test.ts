/**
 * ⭐ 지출 분류 정본(expense-cats) — 상대 열쇠·SQL 쌍둥이·적요 규칙표 (개편 5단계 갈래 D, 2026-09-13)
 *
 *   지키는 것:
 *     · payerKeyOf 의 머리표 떼기 규칙(머리표만 있으면 머리표가 이름, 카드는 trim 만)
 *     · PAYER_KEY_SQL 이 payerKeyOf 와 같은 단계·같은 순서인지 — SQL 을 실행하지 않고
 *       문자열 모양으로 지킨다 (2026 감사 G6: 백슬래시 하나 빠져 통장 줄 0건 적용 사고)
 *     · payerKeySql / descRuleSql 접두사 붙이기가 컬럼을 하나도 빠뜨리지 않는지
 *     · DESC_RULES 13개의 모양(이름 유일·분류 유효·허용 컬럼만·괄호 균형·주주 제외)
 *     · CARD_SETTLE_PATTERN_SQL 의 괄호·MAXRUN 제외·expense-core:91 치환 뒤 접두사 누락 0
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_SETTLE_PATTERN_SQL,
  DESC_RULES,
  EXPENSE_CATS,
  EXPENSE_IN_PL,
  PAYER_KEY_SQL,
  REFUND_CAT,
  descRuleSql,
  payerKeyOf,
  payerKeySql,
} from "./expense-cats";

/* ------------------------------------------------------------------
 * 도우미 — SQL 문자열을 실행 없이 살펴보는 도구
 * ---------------------------------------------------------------- */

/** 작은따옴표 문자열 리터럴을 빈 리터럴로 바꾼다 — 리터럴 안의 괄호·낱말이 검사에 안 섞이게 */
const stripLiterals = (s: string): string => s.replace(/'(?:[^']|'')*'/g, "''");

/** 리터럴 밖 괄호가 균형인가 (깊이가 음수로 내려가지도 않는다) */
function parensBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of stripLiterals(s)) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** 리터럴 밖의 식별자(영문 낱말) 목록 */
const identifiers = (s: string): string[] => stripLiterals(s).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

/** 접두사 없는 컬럼 이름 — `.` 이나 낱말 글자 뒤에 오지 않는 source/description/out_amount */
const bareColumns = (s: string): string[] =>
  stripLiterals(s).match(/(?<![.\w])(source|description|out_amount)\b/g) ?? [];

/** 조각들이 이 순서대로 나타나는가 (각 조각은 앞 조각 뒤에서 찾는다) */
function inOrder(hay: string, parts: string[]): number[] {
  const found: number[] = [];
  let from = 0;
  for (const p of parts) {
    const i = hay.indexOf(p, from);
    assert.ok(i >= 0, `조각을 못 찾음: ${p}`);
    found.push(i);
    from = i + p.length;
  }
  return found;
}

/* ------------------------------------------------------------------
 * 분류 목록
 * ---------------------------------------------------------------- */

describe("EXPENSE_CATS — 분류 목록", () => {
  test("이름이 겹치지 않고 빈 값이 없다", () => {
    assert.equal(new Set(EXPENSE_CATS).size, EXPENSE_CATS.length);
    assert.ok(EXPENSE_CATS.every((c) => c.trim().length > 0));
  });

  test("손익 「쓴 돈」 분류는 전부 목록 안에 있고 매입대금·카드대금·내부이체·주주거래·환불은 뺀다", () => {
    const all = new Set<string>(EXPENSE_CATS);
    for (const c of EXPENSE_IN_PL) assert.ok(all.has(c), c);
    const inPl = new Set<string>(EXPENSE_IN_PL);
    for (const c of ["매입대금", "카드대금", "내부이체", "주주거래", REFUND_CAT]) assert.ok(!inPl.has(c), c);
  });

  test("REFUND_CAT 은 목록 안에 있다", () => {
    assert.ok((EXPENSE_CATS as readonly string[]).includes(REFUND_CAT));
  });
});

/* ------------------------------------------------------------------
 * payerKeyOf — 상대 열쇠
 * ---------------------------------------------------------------- */

describe("payerKeyOf — 통장 머리표 떼기 · 카드는 trim 만", () => {
  const rows: [source: string, description: string, expected: string, why: string][] = [
    ["통장", "[BZ이체] 홍길동", "홍길동", "머리표를 뗀다"],
    ["통장", "[BZ이체]홍길동", "홍길동", "머리표 뒤 공백이 없어도 뗀다"],
    ["통장", "[BZ이체]   홍길동  ", "홍길동", "머리표 뒤 공백 여러 개·꼬리 공백"],
    ["통장", "[현금]", "현금", "머리표만 있으면 머리표가 이름 (2025 진행 2026-08-27)"],
    ["통장", "[CD입금]   ", "CD입금", "머리표 뒤 공백뿐이어도 머리표가 이름"],
    ["통장", "홍길동", "홍길동", "머리표가 없으면 그대로"],
    ["통장", "  홍길동  ", "홍길동", "머리표 없으면 trim"],
    ["통장", "[유동CC] [BZ이체] 홍길동", "[BZ이체] 홍길동", "머리표는 맨 앞 하나만 뗀다"],
    ["통장", "홍길동 [메모]", "홍길동 [메모]", "앞이 아니면 머리표가 아니다"],
    ["통장", "", "", "빈 적요는 빈 열쇠"],
    ["법인카드", "[BZ이체] 홍길동", "[BZ이체] 홍길동", "카드는 대괄호를 안 뗀다"],
    ["법인카드", "  본죽엔비빔밥 속초점 ", "본죽엔비빔밥 속초점", "카드는 trim 만"],
    ["법인카드", "", "", "카드 빈 적요"],
    ["기타", "[현금] 홍길동", "[현금] 홍길동", "통장이 아닌 원천은 전부 trim 만"],
  ];
  for (const [source, description, expected, why] of rows) {
    test(`${why}: ${source} / ${JSON.stringify(description)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(payerKeyOf(source, description), expected);
    });
  }
});

/* ------------------------------------------------------------------
 * PAYER_KEY_SQL — TS 와 같은 규칙의 SQL 쌍둥이
 * ---------------------------------------------------------------- */

describe("PAYER_KEY_SQL — payerKeyOf 와 같은 단계·같은 순서", () => {
  test("통장이면 ① 머리표 떼기 ② 빈 값이면 머리표 ③ 그래도 없으면 원문 순으로 COALESCE, 아니면 trim 만", () => {
    inOrder(PAYER_KEY_SQL, [
      "CASE WHEN source = '통장' THEN",
      "COALESCE(",
      "NULLIF(trim(regexp_replace(description,",
      "substring(description from",
      "trim(description)",
      "ELSE trim(description) END",
    ]);
  });

  test("머리표 정규식이 TS(^\\[[^\\]]*\\]) 와 같은 글자로 들어 있다", () => {
    // 일반 문자열이라 소스의 `\\[` 가 런타임에 `\[` 가 된다 — 그 모양 그대로 SQL 에 실려야 한다
    assert.ok(PAYER_KEY_SQL.includes("regexp_replace(description, '^\\[[^\\]]*\\] *', '')"));
    assert.ok(PAYER_KEY_SQL.includes("substring(description from '^\\[([^\\]]*)\\]')"));
  });

  test("런타임 문자열에 `\\[` 가 실제로 있고, 백슬래시가 두 겹(`\\\\[`)으로 늘어나지 않았다 (감사 G6)", () => {
    assert.ok(PAYER_KEY_SQL.includes("\\["), "대괄호 이스케이프가 사라졌다");
    assert.ok(!PAYER_KEY_SQL.includes("\\\\["), "백슬래시가 두 겹이다 — 템플릿 문자열 사고");
    // 머리표 떼기 3개 + 머리표 뽑기 3개 = 백슬래시 6개
    assert.equal((PAYER_KEY_SQL.match(/\\/g) ?? []).length, 6);
  });

  test("리터럴 안에 컬럼 이름이 없어 split/join 접두사 붙이기가 안전하다", () => {
    const literals = PAYER_KEY_SQL.match(/'(?:[^']|'')*'/g) ?? [];
    assert.ok(literals.length >= 3);
    for (const l of literals) {
      assert.ok(!/source|description/.test(l), `리터럴에 컬럼 이름: ${l}`);
    }
  });

  test("괄호가 균형이고 세미콜론이 없다", () => {
    assert.ok(parensBalanced(PAYER_KEY_SQL));
    assert.ok(!PAYER_KEY_SQL.includes(";"));
  });
});

describe("payerKeySql — 컬럼 접두사 붙이기", () => {
  test("접두사 없으면 PAYER_KEY_SQL 그대로", () => {
    assert.equal(payerKeySql(), PAYER_KEY_SQL);
    assert.equal(payerKeySql(""), PAYER_KEY_SQL);
  });

  test("payerKeySql(\"c.\") 에 접두사 없는 source/description 이 0개", () => {
    const s = payerKeySql("c.");
    assert.deepEqual(bareColumns(s), []);
    assert.equal((s.match(/c\.source/g) ?? []).length, 1);
    assert.equal((s.match(/c\.description/g) ?? []).length, 4);
  });

  test("접두사를 붙여도 정규식 글자는 그대로다", () => {
    const s = payerKeySql("t.");
    assert.ok(s.includes("regexp_replace(t.description, '^\\[[^\\]]*\\] *', '')"));
    assert.equal((s.match(/\\/g) ?? []).length, 6);
  });
});

/* ------------------------------------------------------------------
 * DESC_RULES — 적요 규칙표
 * ---------------------------------------------------------------- */

describe("DESC_RULES — 적요 규칙표 모양", () => {
  /** DescRule.cond 가 써도 되는 것 — 컬럼 2개(문서 주석대로) + SQL 낱말 */
  const ALLOWED_COLUMNS = new Set(["description", "out_amount"]);
  const ALLOWED_WORDS = new Set(["LIKE", "ILIKE", "NOT", "AND", "OR"]);

  test("규칙이 13개다 (늘리면 이 숫자와 why 를 같이 고친다 — 근거 없는 규칙 금지)", () => {
    assert.equal(DESC_RULES.length, 13);
  });

  test("name 이 유일하고 why 가 비어 있지 않다", () => {
    assert.equal(new Set(DESC_RULES.map((r) => r.name)).size, DESC_RULES.length);
    for (const r of DESC_RULES) assert.ok(r.why.trim().length > 0, r.name);
  });

  test("category 가 전부 EXPENSE_CATS 안에 있다", () => {
    const cats = new Set<string>(EXPENSE_CATS);
    for (const r of DESC_RULES) assert.ok(cats.has(r.category), `${r.name}: ${r.category}`);
  });

  test("source 는 없거나 통장·법인카드 중 하나", () => {
    for (const r of DESC_RULES) {
      assert.ok(r.source === undefined || r.source === "통장" || r.source === "법인카드", r.name);
    }
  });

  for (const r of DESC_RULES) {
    test(`「${r.name}」 cond — description·out_amount 외 컬럼 없음 · 괄호 균형 · 세미콜론 없음`, () => {
      for (const id of identifiers(r.cond)) {
        assert.ok(ALLOWED_COLUMNS.has(id) || ALLOWED_WORDS.has(id), `허용되지 않은 낱말: ${id}`);
      }
      assert.ok(identifiers(r.cond).some((id) => ALLOWED_COLUMNS.has(id)), "컬럼을 하나도 안 쓴다");
      assert.ok(parensBalanced(r.cond), "괄호 불균형");
      assert.ok(!r.cond.includes(";"), "세미콜론");
    });

    test(`「${r.name}」 descRuleSql(cond, "c.") — 접두사 없는 컬럼 0개 · 리터럴 안에 컬럼 이름 없음`, () => {
      for (const l of r.cond.match(/'(?:[^']|'')*'/g) ?? []) {
        assert.ok(!/description|out_amount/.test(l), `리터럴에 컬럼 이름: ${l}`);
      }
      assert.deepEqual(bareColumns(descRuleSql(r.cond, "c.")), []);
      assert.equal(descRuleSql(r.cond), r.cond);
      assert.equal(descRuleSql(r.cond, ""), r.cond);
    });
  }

  test("「직원 급여」는 주주(조준호·이현숙)를 조건 안에서 못 박아 뺀다 — 순서에 기대지 않는다", () => {
    const r = DESC_RULES.find((x) => x.name === "직원 급여");
    assert.ok(r, "규칙이 없다");
    assert.equal(r.category, "인건비");
    assert.equal(r.source, "통장");
    assert.ok(r.cond.includes("description NOT LIKE '%조준호%'"));
    assert.ok(r.cond.includes("description NOT LIKE '%이현숙%'"));
    // 급여 낱말 묶음이 괄호로 묶여 있어야 NOT 이 전체에 걸린다
    assert.ok(/^\(.*\) AND description NOT LIKE/.test(r.cond), "급여 조건이 괄호로 안 묶였다");
  });

  test("머리표 규칙(「[…]%」로 시작)은 통장 전용이거나 다른 낱말도 같이 본다", () => {
    for (const r of DESC_RULES) {
      const headerOnly = /^description LIKE '\[[^\]]*\]%'$/.test(r.cond.trim());
      if (headerOnly) assert.equal(r.source, "통장", `${r.name}: 머리표만 보는 규칙은 통장 전용이어야 한다`);
    }
  });
});

/* ------------------------------------------------------------------
 * CARD_SETTLE_PATTERN_SQL — 카드 정산 입금 적요 패턴
 * ---------------------------------------------------------------- */

describe("CARD_SETTLE_PATTERN_SQL — 카드 정산 패턴", () => {
  test("괄호가 균형이고 세미콜론이 없다", () => {
    assert.ok(parensBalanced(CARD_SETTLE_PATTERN_SQL));
    assert.ok(!CARD_SETTLE_PATTERN_SQL.includes(";"));
  });

  test("MAXRUN(온라인몰 판매 대금)은 카드정산에서 뺀다 — 사장님 지적 2026-08-26", () => {
    assert.ok(CARD_SETTLE_PATTERN_SQL.includes("description NOT ILIKE '%MAXRUN%'"));
    // 제외는 AND 로 전체에 걸려야 한다 — 「(… OR …) AND NOT ILIKE」 꼴
    assert.ok(/\) AND description NOT ILIKE '%MAXRUN%'\)$/.test(CARD_SETTLE_PATTERN_SQL));
  });

  test("description 외 다른 컬럼·낱말을 안 쓴다", () => {
    for (const id of identifiers(CARD_SETTLE_PATTERN_SQL)) {
      assert.ok(id === "description" || ["LIKE", "ILIKE", "NOT", "AND", "OR"].includes(id), `허용되지 않은 낱말: ${id}`);
    }
  });

  test("expense-core:91 처럼 \\bdescription\\b 을 c.description 으로 바꾸면 접두사 없는 컬럼 0개", () => {
    const s = CARD_SETTLE_PATTERN_SQL.replace(/\bdescription\b/g, "c.description");
    assert.deepEqual(bareColumns(s), []);
    assert.ok((s.match(/c\.description/g) ?? []).length >= 6);
    // 리터럴 안에는 description 이 없어야 치환이 리터럴을 건드리지 않는다
    for (const l of CARD_SETTLE_PATTERN_SQL.match(/'(?:[^']|'')*'/g) ?? []) {
      assert.ok(!/description/.test(l), `리터럴에 컬럼 이름: ${l}`);
    }
  });

  test("정규식 리터럴의 `\\]` 가 한 겹이다 (백슬래시 두 겹 사고 방지)", () => {
    assert.ok(CARD_SETTLE_PATTERN_SQL.includes("~ '\\] ?"));
    assert.ok(!CARD_SETTLE_PATTERN_SQL.includes("\\\\]"));
  });

  /** 패턴을 JS 로 흉내 내서 대표 적요를 판정한다 — LIKE '%x%' 는 includes, ~ 는 RegExp, NOT ILIKE 는 대소문자 무시 */
  function emulate(description: string): boolean {
    const likes = [...CARD_SETTLE_PATTERN_SQL.matchAll(/description LIKE '%([^']*)%'/g)].map((m) => m[1]);
    const regexes = [...CARD_SETTLE_PATTERN_SQL.matchAll(/description ~ '((?:[^']|'')*)'/g)].map((m) => new RegExp(m[1]));
    const excludes = [...CARD_SETTLE_PATTERN_SQL.matchAll(/description NOT ILIKE '%([^']*)%'/g)].map((m) => m[1].toUpperCase());
    assert.ok(likes.length >= 2 && regexes.length >= 3 && excludes.length >= 1, "패턴 조각 추출 실패");
    const hit = likes.some((l) => description.includes(l)) || regexes.some((r) => r.test(description));
    const out = excludes.some((e) => description.toUpperCase().includes(e));
    return hit && !out;
  }

  const rows: [description: string, expected: boolean, why: string][] = [
    ["[FB자금] 롯데수수료환급", true, "FB자금 머리표"],
    ["[매출표] SH수수료환급", true, "매출표 머리표"],
    ["[FB이체] 현대5816", true, "감사 G10: 현대 뒤 숫자"],
    ["[FB이체] 현5816", true, "현 뒤 숫자"],
    ["[타행PC] KB환급11694", true, "수리 C1: 카드사 이름 + 환급"],
    ["[타행PC] NH우대환급", true, "카드사 이름 + 우대환급"],
    ["[타행FB] 삼성환급946", true, "삼성 + 환급"],
    ["[타행FB] 토스_20260904", true, "토스 간편결제 정산 (2026-09-04)"],
    ["[타행FB] 토스20260904", true, "밑줄 없이 날짜 숫자"],
    ["[타행FB] 토스 홍길동", false, "손님이 토스로 직접 보낸 돈은 이름이 찍힌다"],
    ["[국세] 속초세무서 환급", false, "세무서 환급은 기타입금"],
    ["[FB자금] MAXRUN", false, "맥스런 판매 대금은 카드정산이 아니다"],
    ["[FB자금] maxrun 정산", false, "대소문자 무시로 뺀다"],
    ["[BZ이체] 홍길동", false, "일반 이체"],
    ["[타행PC] 현대자동차", false, "카드사 이름 뒤가 숫자·환급이 아니면 아니다"],
  ];
  for (const [description, expected, why] of rows) {
    test(`${why}: ${description} → ${expected ? "카드정산" : "아님"}`, () => {
      assert.equal(emulate(description), expected);
    });
  }
});
