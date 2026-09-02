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
] as const;

export type PermKey = (typeof PERM_KEYS)[number];

/** 화면 표시용 — 설정→계정의 스위치 순서 그대로 */
export const PERM_LABELS: Record<PermKey, { label: string; hint: string }> = {
  sale: { label: "판매 등록", hint: "판매·예약 등록, 새 손님·차량 등록" },
  sale_edit: { label: "정비 내역 수정", hint: "품목·날짜 고치기, 판매 취소, 시공 완료" },
  stock: { label: "재고", hint: "재고 수량 조정, 실사 엑셀 반영" },
  receiving: { label: "입고·매입", hint: "인보이스 입고, 붙여넣기 매입 (매입가는 원래 사장님만)" },
  customer: { label: "고객·차량 수정", hint: "고객 정보·차량 정보 고치기" },
  mars: { label: "MARS 올리기", hint: "판매를 MARS 큐에 올리기" },
  receivable_view: { label: "외상 보기", hint: "외상 장부 열람 (수금은 원래 사장님만)" },
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

/** 기존 직원 계정 이관·「전부 켜기」 버튼용 */
export function allOnPerms(): PermMap {
  return Object.fromEntries(PERM_KEYS.map((k) => [k, true]));
}

export const PERM_DENIED = "이 기능 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다";
