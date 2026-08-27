/**
 * 「이 지출, 누구한테 뭘 쓴 건가」 — 적요 읽기 (사장님 지적 2026-08-27)
 *
 *   "지출 부분에서 이렇게만 보니까 정확히 뭘로 분류해야할지 알기가 어려워."
 *   "네이버 페이나 파이넨셜은 종류가 많은데 뭔지 잘 모르겠음."
 *
 * 카드 적요는 **결제를 거쳐 온 곳**과 **실제로 산 곳**이 한 줄에 붙어 온다.
 *   `네이버페이주식회사 데이원컴퍼니` → 네이버페이로 결제 · 실제 판매처는 (주)데이원컴퍼니
 * 이걸 안 쪼개면 화면에는 "네이버페이…" 만 잔뜩 보이고, 사장님은 무엇을 산 건지 알 수 없다.
 * 실제로 DB 에 네이버 계열이 **10가지 넘는 이름**으로 흩어져 있다 —
 *   `네이버페이네이버` · `네이버페이-네이버` · `네이버파이낸셜(주)` · `네이버파이낸셜네이버(주)` …
 *
 * 🔴 여기서 하는 일은 **보여주기**뿐이다. 분류를 자동으로 바꾸지 않는다.
 *    상대를 묶는 열쇠(`payerKeyOf`)는 건드리지 않는다 — 그걸 바꾸면 이미 붙여 둔
 *    규칙 사전(expense_rule)이 통째로 안 맞게 된다.
 *
 * 🔴 모르는 것은 **모른다고 둔다.** 짐작으로 "이런 곳입니다" 를 적으면
 *    사장님이 그걸 믿고 잘못 분류한다. 확실한 것만 사전에 넣는다.
 */

import { payerKeyOf } from "./expense-cats";

/* ------------------------------------------------------------------
 * 결제를 거쳐 온 곳 — 뒤에 붙은 이름이 진짜 상대다
 * ---------------------------------------------------------------- */

/** 앞에서 떼어낼 결제대행 이름. 긴 것부터 봐야 `네이버페이` 가 `네이버` 에 먼저 걸리지 않는다 */
const VIA_LIST = [
  "네이버페이알리페이",
  "네이버파이낸셜",
  "네이버페이",
  "카카오쇼핑하기카카오페이",
  "카카오페이",
  "토스페이먼츠",
  "토스페이",
  "스마일페이",
  "페이코",
  "PAYCO",
  "PAYPAL",
  "페이팔",
];

/** 결제대행 이름을 화면에 쓸 말로 (`네이버파이낸셜` → `네이버페이`) */
const VIA_LABEL: Record<string, string> = {
  네이버파이낸셜: "네이버페이",
  네이버페이알리페이: "네이버페이(알리페이)",
  카카오쇼핑하기카카오페이: "카카오페이",
  PAYCO: "페이코",
  PAYPAL: "페이팔",
};

/** 카드 적요 끝에 붙는 지역 */
const REGIONS = [
  "강원", "경기", "서울", "인천", "부산", "대구", "광주", "대전", "울산",
  "세종", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

/* ------------------------------------------------------------------
 * 「이런 곳입니다」 사전
 * ---------------------------------------------------------------- */

interface Known {
  /** 이름 어딘가에 이 글자가 들어 있으면 걸린다 (대소문자 무시) */
  match: string[];
  /** 화면에 뜨는 한 줄 설명 */
  what: string;
  /** 분류가 사실상 정해진 것만 — 애매하면 비운다 */
  hint?: string;
}

/**
 * 🔴 **확실한 것만.** 애매하면 `what` 만 적고 `hint` 는 비운다 —
 *    같은 곳에서 소모품도 사고 접대도 하면 분류가 갈린다.
 */
const KNOWN: Known[] = [
  /* 결제대행 자체 (뒤에 판매처 이름이 안 붙어 온 줄) */
  { match: ["네이버파이낸셜", "네이버페이"], what: "네이버페이 결제 — 무엇을 샀는지는 네이버페이 결제내역에서 봅니다" },
  { match: ["토스페이먼츠"], what: "토스 결제대행 — 무엇을 샀는지는 결제내역에서 봅니다" },

  /* 이름만으로 무엇인지 분명한 곳 */
  { match: ["데이원컴퍼니"], what: "패스트캠퍼스·콜로소 운영사 — 온라인 강의" },
  { match: ["버킷플레이스"], what: "오늘의집 — 인테리어·생활용품" },
  { match: ["GITHUB"], what: "깃허브 — 개발 도구 구독(해외 결제)", hint: "기타경비" },
  { match: ["카페24"], what: "카페24 — 홈페이지·쇼핑몰 호스팅", hint: "기타경비" },
  { match: ["쏘카"], what: "쏘카 — 차량 공유" },
  { match: ["알라딘커뮤니케이션"], what: "알라딘 — 책" },
  { match: ["구글", "GOOGLE"], what: "구글 — 서비스 구독(해외 결제)" },
  { match: ["애플", "APPLE.COM", "ITUNES"], what: "애플 — 서비스 구독(해외 결제)" },
  { match: ["OPENAI", "ANTHROPIC", "CLAUDE.AI"], what: "AI 서비스 구독(해외 결제)", hint: "기타경비" },

  /* 카드사·은행이 떼어 가는 것 — 분류가 정해져 있다 */
  { match: ["카드사용알림", "이용대금명세서", "명세서발송"], what: "카드사 알림 서비스 이용료", hint: "수수료" },
  { match: ["연회비"], what: "카드 연회비", hint: "수수료" },
  { match: ["송금수수료", "이체수수료", "타행이체"], what: "은행 이체 수수료", hint: "수수료" },
];

/* ------------------------------------------------------------------
 * 읽기
 * ---------------------------------------------------------------- */

export interface PayerInfo {
  /** 화면에 크게 쓸 이름 — 결제대행·지역을 떼어낸 실제 상대 */
  name: string;
  /** 결제를 거쳐 온 곳 (`네이버페이`). 없으면 null */
  via: string | null;
  /** 적요 끝에 붙어 있던 지역 (`강원 속초시`). 없으면 null */
  place: string | null;
  /** 「이런 곳입니다」 한 줄. 모르면 null — **짐작해서 적지 않는다** */
  what: string | null;
  /** 사전이 확신하는 분류. 없으면 null */
  hint: string | null;
  /** 상대를 묶는 열쇠 — `payerKeyOf` 그대로 (규칙 사전이 이걸로 붙는다) */
  key: string;
}

/** 이름 어딘가에 그 글자가 있나 (대소문자 무시) */
function has(hay: string, needle: string): boolean {
  return hay.toUpperCase().includes(needle.toUpperCase());
}

/** 적요 끝의 지역을 떼어 낸다 — `에이테크플러스   강원 속초시` */
function splitPlace(s: string): { body: string; place: string | null } {
  for (const r of REGIONS) {
    const i = s.lastIndexOf(r);
    // 지역명 앞에 공백이 있어야 한다 (`강원랜드` 같은 상호를 자르지 않으려고)
    if (i > 0 && /\s/.test(s[i - 1])) {
      const before = s.slice(0, i).trim();
      const place = s.slice(i).trim();
      // 지역 뒤가 너무 길면 상호의 일부다 — 「경기 성남시」 정도까지만 본다
      if (before && place.length <= 12) return { body: before, place };
    }
  }
  return { body: s.trim(), place: null };
}

/** 앞에 붙은 결제대행 이름을 떼어 낸다 */
function splitVia(s: string): { body: string; via: string | null } {
  for (const v of VIA_LIST) {
    if (!s.toUpperCase().startsWith(v.toUpperCase())) continue;
    // 결제대행 이름 뒤에 붙는 구분자(`-`, 공백)를 같이 벗긴다
    let rest = s.slice(v.length).trim();
    while (rest.startsWith("-") || rest.startsWith("·")) rest = rest.slice(1).trim();
    /**
     * 🔴 벗기고 나서 법인 꼬리만 남으면 **판매처가 안 붙어 온 줄**이다.
     *    `네이버파이낸셜(주)` 를 벗기면 `(주)` 만 남아 이름이 그걸로 바뀐다.
     *    그럴 땐 이름을 비워 결제대행 이름이 그대로 이름이 되게 한다.
     */
    const bare = rest.replace(/주식회사|유한회사/g, "").replace(/[()㈜（）\s.,-]/g, "");
    // 한 글자만 남는 것은 `(주)` 의 「주」 같은 부스러기다 — 이름이 될 수 없다
    return { body: bare.length > 1 ? rest : "", via: VIA_LABEL[v] ?? v };
  }
  return { body: s, via: null };
}

/**
 * 적요 한 줄을 사람이 읽을 수 있게 쪼갠다.
 *
 *   `네이버페이RM마케팅      경기 성남시`
 *     → { via: "네이버페이", name: "RM마케팅", place: "경기 성남시" }
 *   `[BZ뱅크] (주)쏘카 장애`
 *     → { name: "(주)쏘카 장애", what: "쏘카 — 차량 공유" }
 */
export function readPayer(source: string, description: string): PayerInfo {
  const key = payerKeyOf(source, description);

  // 지역을 먼저 떼고 결제대행을 벗긴다 — 순서가 바뀌면 `네이버페이네이버 경기 성남시` 가 안 풀린다
  const p = splitPlace(key);
  const v = splitVia(p.body);
  const name = v.body || v.via || key;

  /* 「이런 곳입니다」 — 결제대행을 벗긴 **실제 상대 이름**으로 먼저 찾고,
     못 찾으면 결제대행 자체를 설명한다 (`네이버파이낸셜(주)` 처럼 판매처가 안 붙은 줄) */
  let known = KNOWN.find((k) => k.match.some((m) => has(name, m)));
  if (!known && v.via) known = KNOWN.find((k) => k.match.some((m) => has(v.via!, m)));

  return {
    name,
    // 결제대행 이름이 곧 상대 이름이면(`토스페이먼츠`) 화면에 두 번 쓸 이유가 없다
    via: v.via && v.via !== name ? v.via : null,
    place: p.place,
    what: known?.what ?? null,
    hint: known?.hint ?? null,
    key,
  };
}
