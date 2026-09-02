/**
 * 블로그 카테고리와 글감 — 순수 함수 (D단계, 2026-09-02)
 *
 * 카테고리는 **사장님 블로그에 실제로 있는 12개** 그대로다 (블로그 카테고리 화면에서 확인).
 * 프로그램이 새로 만들지 않는다 — 사장님이 이미 쓰시는 서랍에 넣어야 한다.
 *
 * 🔴 `@/db` 를 import 하지 않는다 — 화면과 테스트가 같이 쓴다.
 */

/** 사장님 블로그 카테고리 12개 (글 42편). 큰 묶음 4 · 하위 12 */
export const CATEGORIES = [
  { group: "센터소개", name: "타이어모어 속초점" },
  { group: "센터소개", name: "공지/이벤트" },
  { group: "센터소개", name: "오시는길" },
  { group: "타이어 교체 사례", name: "국산차 타이어 교환" },
  { group: "타이어 교체 사례", name: "수입차 타이어 교환" },
  { group: "타이어 교체 사례", name: "전기차(EV) 타이어 교환" },
  { group: "경정비 서비스", name: "휠얼라인먼트" },
  { group: "경정비 서비스", name: "배터리" },
  { group: "경정비 서비스", name: "엔진오일/기타" },
  { group: "차량정보", name: "차량 관리팁" },
  { group: "차량정보", name: "차종별 순정 제원" },
] as const;

export type CategoryName = (typeof CATEGORIES)[number]["name"];

/** 국산 제조사 — 이 밖은 수입으로 본다 */
const DOMESTIC = ["현대", "기아", "제네시스", "쉐보레", "르노", "KG", "쌍용", "삼성", "대우", "한국GM"];

/** 전기차로 볼 만한 이름 조각 */
const EV_HINTS = ["테슬라", "모델3", "모델Y", "모델 3", "모델 Y", "아이오닉", "EV6", "EV9", "니로 EV", "코나 일렉트릭", "폴스타", "타이칸", "ID.4"];

export interface CategoryInput {
  maker: string | null;
  model: string | null;
  /** 타이어 품목이 있었나 */
  hasTire: boolean;
  /** 공임·정비 품목 이름들 */
  services: string[];
}

/**
 * 시공 하나가 어느 카테고리 글이 될지 — 사장님이 화면에서 바꿀 수 있다.
 * 🔴 경정비를 타이어보다 **먼저** 본다: 얼라인먼트를 하면서 타이어도 갈았다면
 *    글의 중심은 얼라인먼트다 (사장님 실제 글이 그렇다).
 */
export function inferCategory(x: CategoryInput): CategoryName {
  const svc = x.services.join(" ");
  if (/얼라인|얼라이|정렬|토우|캠버/.test(svc)) return "휠얼라인먼트";
  if (/배터리/.test(svc)) return "배터리";
  if (!x.hasTire && svc.trim()) return "엔진오일/기타";

  const name = `${x.maker ?? ""} ${x.model ?? ""}`;
  if (EV_HINTS.some((h) => name.includes(h))) return "전기차(EV) 타이어 교환";
  const domestic = DOMESTIC.some((d) => (x.maker ?? "").includes(d));
  return domestic ? "국산차 타이어 교환" : "수입차 타이어 교환";
}

/** 계절 글감 — 지금 시기에 맞는 것 한 줄 */
export function seasonTopic(month: number): { title: string; why: string } | null {
  if (month >= 9 && month <= 11)
    return {
      title: "겨울 타이어, 언제 갈아야 할까요 — 속초 기준으로",
      why: "미시령·한계령은 시내보다 먼저 얼어붙습니다. 11월에 물량이 몰리기 전이 검색이 늘기 시작하는 때입니다.",
    };
  if (month === 12 || month <= 2)
    return {
      title: "눈길·빙판에서 타이어가 하는 일 — 공기압과 마모 확인",
      why: "겨울 한복판입니다. 스키·설악산 오시는 외지 차량 검색이 가장 많은 시기입니다.",
    };
  if (month >= 3 && month <= 5)
    return {
      title: "겨울 타이어 벗을 때 같이 봐야 하는 것",
      why: "겨울용을 계속 쓰면 마모가 빨라집니다. 교체 시기 검색이 느는 때입니다.",
    };
  if (month === 6)
    return {
      title: "장마 오기 전 타이어 홈 깊이 확인하는 법",
      why: "젖은 노면 제동은 홈 깊이가 전부입니다. 장마 직전이 가장 잘 읽히는 시기입니다.",
    };
  return {
    title: "여름 휴가철, 속초 오시기 전 타이어 점검",
    why: "속초는 외지 차량 비중이 높습니다. 「여행 중 펑크」는 다른 지역 매장이 못 가지는 검색어입니다.",
  };
}

export interface Topic {
  /** 화면에서 구분할 열쇠 */
  key: string;
  kind: "밀린사진" | "안쓴시공" | "정보성" | "계절";
  title: string;
  /** 왜 지금 이걸 쓰는 게 좋은지 — 한 줄 */
  why: string;
  category: CategoryName;
  /** 눌렀을 때 갈 곳 */
  href: string;
  /** 정보성 글은 시공이 없다 — 이 재료로 쓴다 */
  material?: string;
}

/** 카테고리별로 「마지막으로 쓴 지 며칠」 → 오래 빈 것부터 */
export function stalestCategories(
  lastWritten: { category: string; daysAgo: number | null }[],
  take = 3,
): { category: string; daysAgo: number | null }[] {
  return [...lastWritten]
    .sort((a, b) => (b.daysAgo ?? 9999) - (a.daysAgo ?? 9999))
    .slice(0, take);
}
