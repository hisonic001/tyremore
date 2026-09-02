/**
 * ⭐ 기능 모듈 권한 — 정본 (사장님 요청 2026-09-02)
 *
 *   "각 계정별로 권한을 더 기능모듈별로 세분화"
 *
 *   직원(tech) 영역만 쪼갠다 — 돈 관리·보고서·가격·설정·계정은 기존 isOwner/role
 *   검사 그대로(사장님 전용). owner 는 스위치와 무관하게 전부 된다.
 *
 * 🔴 "use server" 아님 — 키·라벨·판정을 서버 게이트와 화면이 같이 쓴다.
 *    새 모듈이 생기면 여기 한 곳에만 추가한다.
 */

export const PERM_KEYS = [
  "sale",
  "sale_edit",
  "stock",
  "receiving",
  "customer",
  "mars",
  "receivable_view",
  /* ⭐ 2026-09-02 사장님 지시 "해금 가능한 기능들은 일단 넣어놓고 내가 체크로 결정" —
     사장님 전용이던 영역도 스위치로 올린다. 기본은 꺼짐. **계정 관리만은 항상 사장님 전용**
     (직원이 스스로 권한을 켜는 구멍을 막는다). */
  "finance",
  "reports",
  "cost",
  "master",
  "reassign",
  /* ⭐ 마케팅 (2026-09-02) — 여기 없이 isOwner() 로만 막고 있어 정본 규칙에서 벗어나 있었다.
     기본 꺼짐. 사장님이 직원에게 블로그 원고 쓰기를 맡기고 싶어지면 스위치로 열면 된다. */
  "marketing",
] as const;

export type PermKey = (typeof PERM_KEYS)[number];

/** 매장 일(기본 묶음) — 「전부 켜기」는 이 일곱 개만 켠다 */
export const BASE_KEYS: readonly PermKey[] = ["sale", "sale_edit", "stock", "receiving", "customer", "mars", "receivable_view"];
/** 사장님 영역(민감 묶음) — 사장님이 개별로만 해금 */
export const OWNER_KEYS: readonly PermKey[] = ["finance", "reports", "cost", "master", "reassign", "marketing"];

/** 화면 표시용 — 설정→계정의 스위치 순서 그대로 */
export const PERM_LABELS: Record<PermKey, { label: string; hint: string }> = {
  sale: { label: "판매 등록", hint: "판매·예약 등록, 새 손님·차량 등록" },
  sale_edit: { label: "정비 내역 수정", hint: "품목·날짜 고치기, 판매 취소, 시공 완료" },
  stock: { label: "재고", hint: "재고 수량 조정, 실사 엑셀 반영" },
  receiving: { label: "입고·매입", hint: "인보이스 입고, 붙여넣기 매입 (매입가는 원래 사장님만)" },
  customer: { label: "고객·차량 수정", hint: "고객 정보·차량 정보 고치기" },
  mars: { label: "MARS 올리기", hint: "판매를 MARS 큐에 올리기" },
  receivable_view: { label: "외상 보기·수금", hint: "외상 장부 열람과 수금 넣기·한꺼번에 털기 (2026-09-02 묶음)" },
  finance: { label: "돈 관리", hint: "재무 화면 전체 — 업로드·대조·미지급·월 정산·원장 (민감)" },
  reports: { label: "보고서", hint: "매출·재고·마진 리포트 (마진이 보입니다)" },
  cost: { label: "매입가·마진 보기", hint: "판매·재고·입고 화면의 매입원가와 마진 표시 + 매입가 수정" },
  master: { label: "상품·가격·거래처 관리", hint: "상품·공임 목록, 기표가·할인율, 거래처 추가·수정" },
  reassign: { label: "손님·거래처 바꾸기", hint: "판매의 주인을 다른 손님·거래처로 재배정" },
  marketing: { label: "마케팅", hint: "네이버 블로그 원고·리뷰 답글 초안 만들기 (발행은 사람이 직접)" },
};

export type PermMap = Partial<Record<PermKey, boolean>>;

/**
 * 판정 — owner 는 무조건 true, 직원은 켜 둔 것만.
 * perms 가 없거나 키가 없으면 꺼진 것(새 계정 기본 전부 꺼짐 — 사장님 결정 2026-09-02).
 */
export function evalPerm(role: string, perms: PermMap | null | undefined, key: PermKey): boolean {
  if (role === "owner") return true;
  return perms?.[key] === true;
}

/** 기존 직원 계정 이관·「전부 켜기」 버튼용 — 🔴 매장 일 7개만 (민감 5개는 개별 해금) */
export function allOnPerms(): PermMap {
  return Object.fromEntries(BASE_KEYS.map((k) => [k, true]));
}

export const PERM_DENIED = "이 기능 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
