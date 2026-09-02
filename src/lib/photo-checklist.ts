/**
 * 촬영 체크리스트 — 「무엇을 몇 장 찍을지」 정본 (2026-09-02)
 *
 * 사장님 요청: "중구난방으로 사진을 찍기보다 정확히 어떤 사진을 몇장 찍어야 하는지
 *              알 수 있도록."
 *
 * 🔴 이건 제가 지어낸 목록이 아니라 **사장님 폴더에서 뽑은 것**입니다.
 *
 *   · 벤츠 GLS 폴더(73장)에 사장님이 손수 `A-00 계기판 주행거리` … `C-06 계기판 TPMS 소거`
 *     로 이름을 붙여 두셨다. **A(입고·진단) / B(작업) / C(출고·확인) 3막**이 이미 있다.
 *   · 모델3 폴더(24장)는 `00~22` 로 군더더기 없이 정리돼 있다 — 밀도가 가장 좋다.
 *   · 실제 발행 글이 쓰는 사진은 12~16장. 즉 **찍는 건 17~24장, 쓰는 건 12~16장.**
 *
 * 지금 문제는 모자라서가 아니라 **겹쳐서**다 — 임팩트 렌치 4장, 토크렌치 4장,
 * 완성 4장처럼 같은 컷이 반복된다. 이 목록은 **덜 찍고 더 잘 쓰게** 하는 장치다.
 *
 * 🔴 컷을 늘리거나 줄일 때 **이 파일만** 고치면 화면·자리표시자·검사가 같이 따라간다.
 * 🔴 `@/db` 를 import 하지 않는다 — 화면과 테스트가 같이 쓴다.
 */

export type Act = "A" | "B" | "C";

export interface Shot {
  /** `A-00` 처럼 붙는 자리 이름 — 본문 자리표시자와 파일명이 이걸로 1:1이 된다 */
  slot: string;
  act: Act;
  label: string;
  /** 왜 찍는지 — 화면에 작게 보여 준다 */
  why: string;
  /** 🔴 이것만은 꼭 — 이 글의 신뢰를 만드는 컷 */
  must?: boolean;
}

/** 작업 종류 — 블로그 카테고리와 그대로 맞물린다 */
export const WORK_KINDS = [
  "타이어 교체",
  "휠 얼라인먼트",
  "배터리",
  "엔진오일·기타 경정비",
  "TPMS·공기압",
] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** 모든 작업에 공통 — 글의 처음과 끝을 만든다 */
const COMMON_OPEN: Omit<Shot, "slot">[] = [
  {
    act: "A",
    label: "차량 정면 (번호판 가리고)",
    why: "글의 첫 사진. 본사 제출에도 필수입니다",
    must: true,
  },
  {
    act: "A",
    label: "계기판 주행거리 (경고등 있으면 같이)",
    why: "교체 시점의 근거. 글에 정확한 km 를 쓰려면 이 사진이 있어야 합니다",
    must: true,
  },
  {
    act: "A",
    label: "문제 부위 접사",
    why: "이 글의 핵심 증거입니다. 이게 없으면 「했습니다」로 끝나는 글이 됩니다",
    must: true,
  },
];

const COMMON_CLOSE: Omit<Shot, "slot">[] = [
  { act: "C", label: "작업 완료 부위", why: "작업 전과 대비되어야 합니다" },
  { act: "C", label: "계기판 최종 확인 (공기압·경고등 소거)", why: "마무리의 신뢰" },
  { act: "C", label: "출고 차량 측면", why: "글의 마지막 사진" },
];

const BY_KIND: Record<WorkKind, Omit<Shot, "slot">[]> = {
  "타이어 교체": [
    { act: "A", label: "기존 타이어 마모·손상 접사", why: "왜 갈아야 했는지를 보여 줍니다", must: true },
    { act: "A", label: "리프트 위 차량", why: "작업이 시작되는 장면" },
    { act: "B", label: "휠 탈거 (임팩트 렌치)", why: "과정 한 컷이면 충분합니다" },
    { act: "B", label: "새 타이어 제품 라벨 (규격이 보이게)", why: "무엇을 넣었는지 증거", must: true },
    { act: "B", label: "장착 중", why: "" },
    { act: "B", label: "휠 밸런스 측정 화면 (수치가 보이게)", why: "숫자가 찍힌 화면이 글을 믿게 만듭니다", must: true },
    { act: "B", label: "밸런스 웨이트 부착", why: "" },
    { act: "B", label: "휠 보호 조치 (테이프·클램프)", why: "고급 휠일수록 이 한 컷이 값집니다" },
    { act: "B", label: "토크렌치 조임 (다이얼 수치가 보이게)", why: "마무리가 정확했다는 증거", must: true },
    { act: "B", label: "기존·새 타이어 비교", why: "전후 대비가 한 장에 담깁니다" },
  ],
  "휠 얼라인먼트": [
    { act: "A", label: "편마모 부위 접사", why: "얼라인먼트를 봐야 하는 이유 그 자체", must: true },
    { act: "B", label: "타깃·클램프 장착", why: "" },
    { act: "B", label: "측정 전 수치 화면", why: "전후 비교의 앞쪽. 이 글에서 가장 중요한 두 장 중 하나", must: true },
    { act: "B", label: "조절 링크 조정 장면", why: "" },
    { act: "B", label: "하부 점검", why: "" },
    { act: "B", label: "측정 후 수치 화면", why: "전후 비교의 뒤쪽", must: true },
  ],
  배터리: [
    { act: "A", label: "기존 배터리 외관 (부식·라벨)", why: "왜 갈아야 했는지", must: true },
    { act: "B", label: "(-)단자 분리", why: "순서를 지켰다는 표시" },
    { act: "B", label: "탈거", why: "" },
    { act: "B", label: "신품 라벨 (용량·CCA 보이게)", why: "무엇을 넣었는지 증거", must: true },
    { act: "B", label: "신품·구품 비교", why: "" },
    { act: "B", label: "장착·브라켓 체결", why: "" },
  ],
  "엔진오일·기타 경정비": [
    { act: "A", label: "기존 상태 (오염·마모)", why: "왜 갈아야 했는지", must: true },
    { act: "B", label: "탈거", why: "" },
    { act: "B", label: "신품 제품 (라벨 보이게)", why: "무엇을 넣었는지 증거", must: true },
    { act: "B", label: "장착", why: "" },
    { act: "B", label: "함께 본 곳 점검", why: "덤으로 봐 드렸다는 표시" },
  ],
  "TPMS·공기압": [
    { act: "A", label: "경고등 켜진 계기판", why: "증상 그 자체", must: true },
    { act: "B", label: "센서 탈거·확인", why: "" },
    { act: "B", label: "신품 센서 (품번 보이게)", why: "", must: true },
    { act: "B", label: "장착", why: "" },
    { act: "B", label: "공기압 설정 화면", why: "숫자가 보이는 화면", must: true },
    { act: "C", label: "경고등 소거된 계기판", why: "해결됐다는 증거", must: true },
  ],
};

/** 전기차면 이 세 컷이 더 붙는다 — 모델3 폴더에서 뽑았다 */
const EV_EXTRA: Omit<Shot, "slot">[] = [
  { act: "A", label: "잭패드 장착 (전기차 전용)", why: "배터리팩을 보호했다는 표시 — EV 손님이 가장 신경 쓰는 부분", must: true },
  { act: "C", label: "B필러 공기압 스티커", why: "규정 공기압 근거" },
  { act: "C", label: "차량 화면 설정 (공기압·TPMS)", why: "" },
];

/**
 * 작업 종류에 맞는 촬영 목록. 순서가 곧 글의 순서이고, `slot` 이 곧 파일명·자리표시자다.
 * @param ev 전기차면 잭패드 등 3컷이 더 붙는다
 */
export function shotsFor(kind: WorkKind, ev = false): Shot[] {
  const raw = [...COMMON_OPEN, ...BY_KIND[kind], ...(ev ? EV_EXTRA : []), ...COMMON_CLOSE];
  // A → B → C 로 정렬하되 같은 막 안에서는 적어 둔 순서를 지킨다
  const order: Record<Act, number> = { A: 0, B: 1, C: 2 };
  const sorted = raw
    .map((s, i) => ({ s, i }))
    .sort((a, b) => order[a.s.act] - order[b.s.act] || a.i - b.i)
    .map(({ s }) => s);

  const seq: Record<Act, number> = { A: 0, B: 0, C: 0 };
  return sorted.map((s) => {
    const n = seq[s.act]++;
    return { ...s, slot: `${s.act}-${String(n).padStart(2, "0")}` };
  });
}

/** 화면 요약용 — 「타이어 교체: 16컷 (꼭 5컷)」 */
export function shotSummary(kind: WorkKind, ev = false): { total: number; must: number } {
  const all = shotsFor(kind, ev);
  return { total: all.length, must: all.filter((s) => s.must).length };
}
