/**
 * ⭐ 적요 읽기 정본(payer-name) — readPayer·looksLikeFood (개편 5단계 갈래 D, 2026-09-13)
 *
 *   지키는 것:
 *     · 결제대행(네이버페이·카카오페이·페이코…)을 벗기고 실제 상대를 이름으로 세운다,
 *       판매처가 안 붙은 줄은 결제대행 이름이 곧 이름이고 via 는 비운다
 *     · 적요 끝 지역(「강원 속초시」)은 떼되, 상호의 일부(강원랜드)나 긴 주소는 안 뗀다
 *     · KNOWN 사전 — 확실한 곳만 hint, 애매한 곳은 what 만, 모르는 곳은 둘 다 null
 *     · 쿠팡이츠가 쿠팡보다 먼저 잡힌다 (사전 순서 의존)
 *     · key 는 payerKeyOf 그대로 (규칙 사전이 이걸로 붙는다) — 통장 머리표 줄 포함
 *     · 음식점처럼 보이면 「음식점으로 보입니다」 제안 (통장 줄도)
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { looksLikeFood, readPayer, type PayerInfo } from "./payer-name";
import { payerKeyOf } from "./expense-cats";

const NAVER_VIA_WHAT = "네이버페이 결제 — 무엇을 샀는지는 네이버페이 결제내역에서 봅니다";

describe("readPayer — 통째 비교 (대표 4줄)", () => {
  test("결제대행 + 판매처: 네이버페이주식회사 데이원컴퍼니", () => {
    const r = readPayer("법인카드", "네이버페이주식회사 데이원컴퍼니");
    const expected: PayerInfo = {
      name: "주식회사 데이원컴퍼니",
      via: "네이버페이",
      place: null,
      what: "패스트캠퍼스·콜로소 운영사 — 온라인 강의",
      hint: null,
      key: "네이버페이주식회사 데이원컴퍼니",
    };
    assert.deepEqual(r, expected);
  });

  test("결제대행만 온 줄: 네이버파이낸셜(주) → 이름은 네이버페이, via 는 비운다", () => {
    const r = readPayer("법인카드", "네이버파이낸셜(주)");
    const expected: PayerInfo = {
      name: "네이버페이",
      via: null,
      place: null,
      what: NAVER_VIA_WHAT,
      hint: null,
      key: "네이버파이낸셜(주)",
    };
    assert.deepEqual(r, expected);
  });

  test("지역 + 결제대행: 네이버페이RM마케팅      경기 성남시", () => {
    const r = readPayer("법인카드", "네이버페이RM마케팅      경기 성남시");
    const expected: PayerInfo = {
      name: "RM마케팅",
      via: "네이버페이",
      place: "경기 성남시",
      // 판매처는 사전에 없지만 결제대행은 안다 — 결제대행 설명으로 대신한다
      what: NAVER_VIA_WHAT,
      hint: null,
      key: "네이버페이RM마케팅      경기 성남시",
    };
    assert.deepEqual(r, expected);
  });

  test("통장 머리표 줄: [BZ뱅크] (주)쏘카 장애 → 머리표는 key 에서도 빠진다", () => {
    const r = readPayer("통장", "[BZ뱅크] (주)쏘카 장애");
    const expected: PayerInfo = {
      name: "(주)쏘카 장애",
      via: null,
      place: null,
      what: "쏘카 — 차량 공유",
      hint: null,
      key: "(주)쏘카 장애",
    };
    assert.deepEqual(r, expected);
  });
});

describe("readPayer — 표 (이름 · via · 지역 · hint)", () => {
  type Row = {
    source: string;
    desc: string;
    name: string;
    via?: string | null;
    place?: string | null;
    hint?: string | null;
    what?: string | null;
    why: string;
  };
  const rows: Row[] = [
    /* 결제대행 벗기기 */
    { source: "법인카드", desc: "카카오페이-배달의민족", name: "배달의민족", via: "카카오페이", hint: "식대·접대", why: "구분자 - 를 같이 벗긴다" },
    { source: "법인카드", desc: "PAYCO 11번가", name: "11번가", via: "페이코", hint: null, what: "11번가 — 무엇을 샀는지는 주문내역에서 봅니다", why: "영문 결제대행은 한글 표시명으로" },
    { source: "법인카드", desc: "카카오쇼핑하기카카오페이 버킷플레이스", name: "버킷플레이스", via: "카카오페이", hint: null, what: "오늘의집 — 인테리어·생활용품", why: "긴 결제대행 이름이 먼저 걸린다" },
    { source: "법인카드", desc: "네이버페이알리페이 ALIEXPRESS", name: "ALIEXPRESS", via: "네이버페이(알리페이)", why: "네이버페이알리페이는 네이버페이보다 먼저 본다" },
    { source: "법인카드", desc: "토스페이먼츠", name: "토스페이먼츠", via: null, what: "토스 결제대행 — 무엇을 샀는지는 결제내역에서 봅니다", hint: null, why: "결제대행 이름이 곧 이름이면 via 는 비운다" },
    { source: "법인카드", desc: "네이버페이네이버 경기 성남시", name: "네이버", via: "네이버페이", place: "경기 성남시", why: "지역을 먼저 떼야 결제대행이 풀린다" },
    { source: "통장", desc: "[BZ이체] 네이버파이낸셜", name: "네이버페이", via: null, what: NAVER_VIA_WHAT, why: "통장 줄도 결제대행을 벗긴다" },

    /* 지역 접미 */
    { source: "법인카드", desc: "에이테크플러스   강원 속초시", name: "에이테크플러스", via: null, place: "강원 속초시", hint: null, what: null, why: "끝의 지역을 뗀다" },
    { source: "법인카드", desc: "강원랜드", name: "강원랜드", place: null, why: "맨 앞 지역명은 상호의 일부" },
    { source: "법인카드", desc: "속초부산어묵", name: "속초부산어묵", place: null, why: "앞에 공백이 없으면 상호의 일부" },
    { source: "법인카드", desc: "어떤상호 경기도 성남시 분당구 정자동 어딘가", name: "어떤상호 경기도 성남시 분당구 정자동 어딘가", place: null, why: "지역 뒤가 12자보다 길면 안 뗀다" },
    { source: "법인카드", desc: "쿠팡이츠 서울 송파구", name: "쿠팡이츠", place: "서울 송파구", hint: "식대·접대", why: "지역 떼고 사전 조회" },

    /* KNOWN — 확실한 것만 hint */
    { source: "법인카드", desc: "한화생명04027", name: "한화생명04027", hint: "세금·보험", what: "생명보험료 — 매달 같은 날 1,011,600원", why: "회차 숫자가 붙어도 걸린다" },
    { source: "통장", desc: "[BZ이체] 한화생명05028", name: "한화생명05028", hint: "세금·보험", why: "통장 머리표 줄도 같은 hint" },
    { source: "법인카드", desc: "한국전력공사", name: "한국전력공사", hint: "공과금", why: "전기요금" },
    { source: "법인카드", desc: "세무법인 청솔", name: "세무법인 청솔", hint: "수수료", why: "세무 기장료" },
    { source: "법인카드", desc: "CJ대한통운택배", name: "CJ대한통운택배", hint: "기타경비", why: "택배·화물" },
    { source: "법인카드", desc: "GitHub, Inc.", name: "GitHub, Inc.", hint: "기타경비", why: "대소문자 무시로 걸린다" },
    { source: "법인카드", desc: "카드사용알림서비스", name: "카드사용알림서비스", hint: "수수료", why: "카드사가 떼어 가는 것" },
    { source: "법인카드", desc: "버킷플레이스", name: "버킷플레이스", hint: null, what: "오늘의집 — 인테리어·생활용품", why: "애매한 곳은 what 만, hint 는 비운다" },
    { source: "법인카드", desc: "구글 GOOGLE PLAY", name: "구글 GOOGLE PLAY", hint: null, what: "구글 — 서비스 구독(해외 결제)", why: "구독은 what 만" },

    /* 순서 의존: 쿠팡이츠 < 쿠팡 */
    { source: "법인카드", desc: "쿠팡이츠", name: "쿠팡이츠", hint: "식대·접대", what: "쿠팡이츠 — 음식 배달", why: "쿠팡이츠는 밥값" },
    { source: "법인카드", desc: "쿠팡", name: "쿠팡", hint: null, what: "쿠팡 — 무엇을 샀는지는 쿠팡 주문내역에서 봅니다", why: "쿠팡은 쇼핑이라 hint 없음" },
    { source: "법인카드", desc: "쿠팡페이 쿠팡이츠", name: "쿠팡페이 쿠팡이츠", hint: "식대·접대", why: "쿠팡이 앞에 있어도 쿠팡이츠가 이긴다" },

    /* 음식점 제안 */
    { source: "통장", desc: "[신한체] 장사식당", name: "장사식당", hint: "식대·접대", what: "음식점으로 보입니다", why: "체크카드 밥값이 통장에 찍힌다 (2026-08-27 정정)" },
    { source: "법인카드", desc: "본죽엔비빔밥 속초점", name: "본죽엔비빔밥 속초점", hint: "식대·접대", what: "음식점으로 보입니다", why: "카드 밥값" },
    /**
     * 🔴 현행 동작 기록 (의심 지점, payer-name.ts:232 → :242): 결제대행을 벗긴 이름이 음식점처럼 보여도
     *    결제대행 사전(네이버페이)이 먼저 known 에 잡혀 「음식점으로 보입니다」 제안이 안 나온다.
     *    고치면 이 줄이 깨진다 — 그때 hint 를 "식대·접대" 로 바꾸는 것이 맞다.
     */
    { source: "법인카드", desc: "네이버페이 갈비시대", name: "갈비시대", via: "네이버페이", hint: null, what: NAVER_VIA_WHAT, why: "결제대행 뒤 음식점은 결제대행 설명이 이긴다(현행)" },

    /* 모르는 곳 */
    { source: "법인카드", desc: "어디인지모를상점", name: "어디인지모를상점", via: null, place: null, what: null, hint: null, why: "모르면 모른다고 둔다" },
    { source: "통장", desc: "[현금]", name: "현금", via: null, place: null, what: null, hint: null, why: "머리표뿐인 줄은 머리표가 이름" },
    { source: "통장", desc: "[BZ이체] 홍길동", name: "홍길동", via: null, what: null, hint: null, why: "사람 이름" },
  ];

  for (const row of rows) {
    test(`${row.why}: ${row.source} / ${row.desc}`, () => {
      const r = readPayer(row.source, row.desc);
      assert.equal(r.name, row.name, "name");
      if (row.via !== undefined) assert.equal(r.via, row.via, "via");
      if (row.place !== undefined) assert.equal(r.place, row.place, "place");
      if (row.hint !== undefined) assert.equal(r.hint, row.hint, "hint");
      if (row.what !== undefined) assert.equal(r.what, row.what, "what");
      assert.equal(r.key, payerKeyOf(row.source, row.desc), "key 는 payerKeyOf 그대로");
    });
  }
});

describe("readPayer — 불변 규칙", () => {
  test("hint 가 있으면 what 도 있다 (설명 없이 분류만 던지지 않는다)", () => {
    for (const d of ["한화생명04027", "쿠팡이츠", "CJ대한통운택배", "장사식당", "GITHUB"]) {
      const r = readPayer("법인카드", d);
      assert.ok(r.hint === null || r.what !== null, d);
    }
  });

  test("via 는 name 과 절대 같지 않다", () => {
    for (const d of ["토스페이먼츠", "네이버파이낸셜(주)", "네이버페이", "카카오페이", "페이코"]) {
      const r = readPayer("법인카드", d);
      assert.notEqual(r.via, r.name, d);
    }
  });

  test("이름은 비지 않는다 — 벗기고 남은 게 없으면 결제대행, 그것도 없으면 key", () => {
    for (const d of ["네이버파이낸셜(주)", "PAYPAL", "홍길동", "  홍길동  "]) {
      assert.ok(readPayer("법인카드", d).name.length > 0, d);
    }
  });
});

describe("looksLikeFood — 음식점으로 보이는가", () => {
  const yes = ["속초항생선구이찜전문", "갈비시대", "송도물회", "본죽엔비빔밥 속초점", "정든식당", "족발야시장앤무청감자탕속초교동점", "스타벅스커피", "진대감참숯화로구이"];
  const no = ["에이테크플러스", "한화생명04027", "STARBUCKS", "CJ대한통운택배", "", "강원랜드"];
  for (const n of yes) test(`음식점: ${n}`, () => assert.equal(looksLikeFood(n), true));
  for (const n of no) test(`아님: ${JSON.stringify(n)}`, () => assert.equal(looksLikeFood(n), false));
});
