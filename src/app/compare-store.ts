"use client";

/**
 * ⭐ 담아둔 타이어 (사장님 요청 2026-08-01)
 *
 * > "스태거드 타이어의 경우 다시 검색을 하면서 이전 타이어 가격을 볼 수 없는 경우가
 * >  생기니 검색화면에서 작게 타이어 값을 비교나 확인 가능하게 저장하는 기능"
 *
 * 스태거드는 앞뒤 규격이 다르다 (앞 245/35R20 · 뒤 275/30R20).
 * 앞을 찾아 가격을 보고 뒤를 검색하는 순간 앞 가격이 사라진다.
 * 담아두면 남는다.
 *
 * 저장은 브라우저(localStorage)에 한다. 상담 중 임시 메모이므로 서버에 둘 이유가 없고,
 * 인터넷이 끊겨도 남는다. 견적서를 만들 때 DB로 승격시킨다.
 */

const KEY = "tyremore.compare.v1";
const EVENT = "tyremore:compare";

export interface CompareItem {
  productId: number;
  model: string;
  spec: string | null;
  brandName: string | null;
  listPrice: number;
  salePrice: number;
  qty: number;
  unit: string;
}

function read(): CompareItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CompareItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: CompareItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* 저장 공간이 없어도 화면은 계속 동작해야 한다 */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getCompare(): CompareItem[] {
  return read();
}

/** 같은 상품을 또 담으면 수량이 더해진다 — 앞 2본 담고 또 2본 담는 경우 */
export function addToCompare(item: CompareItem) {
  const items = read();
  const i = items.findIndex((x) => x.productId === item.productId);
  if (i >= 0) {
    items[i] = { ...item, qty: items[i].qty + item.qty };
  } else {
    items.push(item);
  }
  write(items);
}

export function setCompareQty(productId: number, qty: number) {
  const items = read().map((x) => (x.productId === productId ? { ...x, qty: Math.max(1, qty) } : x));
  write(items);
}

export function removeFromCompare(productId: number) {
  write(read().filter((x) => x.productId !== productId));
}

export function clearCompare() {
  write([]);
}

/** 화면이 목록 변화를 따라오게 한다 */
export function subscribeCompare(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn); // 다른 탭에서 바꿔도 반영
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
