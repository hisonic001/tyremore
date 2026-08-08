"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ⭐ 할인율 ↔ 판매가 계산 (사장님 요청 2026-08-08)
 *
 *   "작업내역에 타이어 카드가 입력되면 품목검색에서의 카드처럼 계산이 가능한
 *    기능이 들어갔으면. 정비내역에서 고치기할 때도 똑같은 계산이."
 *
 * 검색 카드의 PriceTool 과 같은 셈법이다: 할인%를 치면 단가가 따라오고,
 * 단가를 고치면 할인%가 따라온다. 기준은 기표가(VAT 포함).
 * 기표가를 모르는 상품(직접 입력·공임)에는 나타나지 않는다.
 */
export function RateBox({
  listPrice,
  price,
  onPrice,
}: {
  /** 기표가 (VAT 포함) — null 이면 이 부품은 그리지 않는다 */
  listPrice: number | null;
  /** 현재 단가 — 부모가 들고 있는 값 */
  price: number;
  /** 할인%를 쳐서 단가가 바뀔 때 부모에게 알린다 */
  onPrice: (n: number) => void;
}) {
  const lp = listPrice ?? 0;
  const pctOf = (p: number) => (lp > 0 ? String(Math.round((1 - p / lp) * 1000) / 10) : "");
  const [rate, setRate] = useState(() => (price > 0 ? pctOf(price) : ""));
  // 단가 입력칸 쪽에서 고치면 %가 따라온다 (우리가 보낸 변경은 건너뛴다)
  const sent = useRef(price);
  useEffect(() => {
    if (price !== sent.current) {
      sent.current = price;
      setRate(price > 0 ? pctOf(price) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price]);

  if (!listPrice || listPrice <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
      <span>할인</span>
      <input
        value={rate}
        onChange={(e) => {
          const c = e.target.value.replace(/[^\d.]/g, "");
          setRate(c);
          if (c === "" || Number.isNaN(Number(c))) return;
          const p = Math.round(lp * (1 - Number(c) / 100));
          sent.current = p;
          onPrice(p);
        }}
        inputMode="decimal"
        placeholder="—"
        aria-label="할인율"
        className="tabular h-9 w-14 rounded-lg border border-slate-300 bg-white px-1.5 text-right text-sm font-bold outline-none focus:border-slate-900"
      />
      <span>%</span>
      <span className="tabular ml-1 text-slate-400">기표가 {listPrice.toLocaleString()}원</span>
    </span>
  );
}
