"use client";

/**
 * ⭐ 판매 등록 임시 저장 (사장님 요청 2026-08-19)
 *
 * > "판매등록 도중에 임시저장이 가능한 기능. 홈화면에서 타이어 검색 후 타이어 담기
 * >  기능처럼. 판매등록하던 내용들도 임시저장 버튼을 따로 만들어서 옆쪽에 따로 저장"
 *
 * 손님이 겹칠 때 쓰던 판을 접어 두고 다른 손님을 먼저 등록하는 용도다.
 * 담아둔 타이어(compare-store)와 같은 방식 — 브라우저(localStorage)에 남긴다.
 * 상담 중 임시 메모라 서버에 둘 이유가 없고, 판매 확정을 누르는 순간 DB 로 승격된다.
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
}

export interface SaleDraft {
  id: string;
  /** '14:02' — 접어둔 시각 */
  savedAt: string;
  /** '32가1234 김철수 · 2줄 · 384,000원' */
  label: string;
  state: SaleDraftState;
}

function read(): SaleDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SaleDraft[]) : [];
  } catch {
    return [];
  }
}

function write(items: SaleDraft[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 저장 공간이 없어도 화면은 계속 동작해야 한다 */
  }
}

export function listSaleDrafts(): SaleDraft[] {
  return read();
}

export function saveSaleDraft(label: string, state: SaleDraftState): SaleDraft {
  const d: SaleDraft = {
    id: `d${Date.now()}`,
    savedAt: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }),
    label,
    state,
  };
  write([d, ...read()].slice(0, 20)); // 폭주 방지 — 20건이면 충분하다
  return d;
}

export function removeSaleDraft(id: string): void {
  write(read().filter((d) => d.id !== id));
}
