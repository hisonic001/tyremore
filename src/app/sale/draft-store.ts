"use client";

/**
 * ⭐ 판매 등록 임시 저장 — 타입 정본 + 옛 localStorage 이사 (2026-09-07 개편)
 *
 * 처음(2026-08-19)에는 localStorage(기기별)였는데, 사장님 요청으로 **서버 보관**
 * 으로 옮겼다 — "임시저장된 내용은 다른 계정들에서도 공유가 가능해서 같이 볼 수
 * 있어야 함." 저장·목록·삭제는 이제 lib/sale-draft.ts(서버 액션, sale_draft 표)가
 * 정본이고, 이 파일에는 **상태 타입**과 옛 기기에 남은 것을 서버로 올리는
 * **일회성 이사**만 남는다.
 */

const KEY = "tyremore.saledraft.v1";

/** SaleForm 의 화면 상태 그대로 — 불러오면 그 자리로 돌아간다 */
export interface SaleDraftState {
  vehicle: unknown | null;
  supplierSale: string | null;
  walkIn: { name: string; phone: string; plateNo: string };
  mileage: string;
  rows: unknown[];
  payMethods: string[];
  payAmounts: Record<string, string>;
  combo: boolean;
  memo: string;
  workDate: string;
  wheels: string[];
  /** 신규 손님 폼의 중간 입력 (2026-08-19) — 반쯤 쓰다 접어도 그대로 돌아온다 */
  newCustomer?: unknown | null;
  /** ⭐ 2026-09-07 보강 — 접히지 않아 복원 때 유실되던 두 칸 */
  payDates?: Record<string, string>;
  reserve?: boolean;
}

/** 옛 localStorage 에 남은 접어둔 판매 — 서버로 이사 보낼 때 한 번 읽는다 */
export function readLegacyDrafts(): { label: string; state: SaleDraftState }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as { label?: string; state?: SaleDraftState }[];
    return items
      .filter((d) => d && d.state)
      .map((d) => ({ label: d.label ?? "접어둔 판매", state: d.state! }));
  } catch {
    return [];
  }
}

/** 이사 성공 후 옛 창고를 비운다 — 두 번 올라가면 카드가 겹친다 */
export function clearLegacyDrafts(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* 못 지워도 다음에 다시 시도될 뿐 — 서버 쪽은 이사 전 개수로 판단하지 않는다 */
  }
}
