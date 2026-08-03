"use client";

import { useState } from "react";
import { addToCompare } from "./compare-store";

const won = (n: number) => n.toLocaleString();

/**
 * ⭐ 검색 카드 안에서 바로 계산한다 (사장님 요청 2026-08-01)
 *
 * 상품을 눌러 들어갔다 나오는 왕복이 상담 중에는 부담이다.
 * 목록을 보면서 그 자리에서 할인율을 넣고 수량을 잡는다.
 *
 * 수량 기본값은 **1본**. 4본 금액은 항상 따로 보여준다 — 타이어는 4본 교체가 흔하고,
 * 고객이 묻는 것도 대개 "네 짝 얼마"다.
 *
 * 🔴 여기서 친 할인율은 **저장하지 않는다** (사장님 지시 2026-08-03).
 *
 *    "25% 돌리기 버튼 만들기보다는 차라리 새로고침이나 새 창을 열면
 *     25%로 돌아가게 만드는 게 훨씬 나을 것 같아"
 *
 *    상담 중에 깎아 주는 값은 그 손님에게 한 번 쓰는 값이지, 그 상품의 새 가격이
 *    아니다. 예전에는 자동 저장돼서 다음 손님에게도 그 할인율이 따라붙었고,
 *    되돌릴 방법도 없었다. 이제 새로고침하면 언제나 기본 할인율(25%)에서 시작한다.
 *
 *    ⚠️ 기본 할인율 자체를 바꾸려면 `scripts/set-default-rate.ts` 를 쓴다.
 *       상담 화면에서 무심코 친 숫자가 마스터를 덮는 일은 이제 없다.
 */
export function PriceTool({
  productId,
  model,
  spec,
  brandName,
  listPrice,
  salesRate,
  unit,
}: {
  productId: number;
  model: string;
  spec: string | null;
  brandName: string | null;
  listPrice: number;
  /** 기본 할인율 — 화면을 열 때마다 여기서 시작한다 */
  salesRate: number | null;
  unit: string;
}) {
  const pct = (r: number) => String(Math.round(r * 1000) / 10);
  const [rate, setRate] = useState(salesRate !== null ? pct(salesRate) : "");
  const [sale, setSale] = useState(salesRate !== null ? String(Math.round(listPrice * (1 - salesRate))) : "");
  const [qty, setQty] = useState(1);
  /** 기본값에서 손댔나 — 손댔을 때만 「이번만」 이라고 알려 준다 */
  const touched = salesRate === null ? rate !== "" : rate !== pct(salesRate);

  /** 할인율 → 판매가 */
  function onRate(v: string) {
    const c = v.replace(/[^\d.]/g, "");
    setRate(c);
    if (c === "" || Number.isNaN(Number(c))) return setSale("");
    setSale(String(Math.round(listPrice * (1 - Number(c) / 100))));
  }
  /** 판매가 → 할인율 */
  function onSale(v: string) {
    const c = v.replace(/\D/g, "");
    setSale(c);
    if (c === "" || listPrice <= 0) return setRate("");
    setRate(String(Math.round((1 - Number(c) / listPrice) * 1000) / 10));
  }

  const saleNum = sale === "" ? null : Number(sale);

  const BTN = "h-11 w-11 shrink-0 rounded-lg border border-slate-300 bg-white text-xl font-bold active:bg-slate-100";

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      {/* 할인율 ↔ 판매가 — 어느 쪽을 넣어도 나머지가 따라온다 */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">할인</span>
          <input
            value={rate}
            onChange={(e) => onRate(e.target.value)}
            inputMode="decimal"
            placeholder="—"
            aria-label="할인율"
            className="tabular h-11 w-16 rounded-lg border-2 border-slate-300 px-2 text-right text-lg font-bold outline-none focus:border-slate-900"
          />
          <span className="text-sm text-slate-500">%</span>
        </label>

        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">판매</span>
          <input
            value={saleNum === null ? "" : won(saleNum)}
            onChange={(e) => onSale(e.target.value)}
            inputMode="numeric"
            placeholder="—"
            aria-label="판매가"
            className="tabular h-11 w-28 rounded-lg border-2 border-slate-300 px-2 text-right text-lg font-bold outline-none focus:border-slate-900"
          />
          <span className="text-sm text-slate-500">원</span>
        </label>

        {/*
          기본값에서 손댔을 때만 알려 준다 — 이 값은 저장되지 않는다는 뜻이다.
          되돌리려면 새로고침만 하면 된다 (사장님 지시 2026-08-03).
        */}
        {touched && salesRate !== null && (
          <span className="text-xs text-slate-400">이번만 · 새로고침하면 {pct(salesRate)}%</span>
        )}

        {/*
          수량 — 기본 1본.
          단위(「본」)는 빼 두었다 (사장님 지시 2026-08-03). 아래 합계 줄에 이미 적혀 있고,
          − □ + 사이에 끼면 눌러야 할 버튼이 좁아진다.
        */}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={BTN} onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <input
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
            inputMode="numeric"
            aria-label={`수량(${unit})`}
            className="tabular h-11 w-12 rounded-lg border border-slate-300 text-center text-lg font-bold"
          />
          <button type="button" className={BTN} onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </div>
      </div>

      {/*
        합계 — 4본은 **항상** 따로 보여준다 (사장님 요청).
        타이어는 네 짝 교체가 흔하고, 고객이 묻는 것도 대개 "네 짝 얼마"다.
        할인율이 아직 없으면 기표가 기준으로라도 보여준다.
      */}
      <div className="tabular mt-2 flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
        {qty !== 4 && (
          <span className="text-sm text-slate-500">
            {qty}
            {unit}{" "}
            <span className={saleNum !== null ? "font-semibold text-slate-800" : "text-slate-400"}>
              {won((saleNum ?? listPrice) * qty)}원
            </span>
          </span>
        )}
        <span className="text-sm text-slate-500">
          4{unit}{" "}
          <span
            className={
              saleNum !== null ? "text-lg font-bold text-slate-900" : "text-base font-medium text-slate-400"
            }
          >
            {won((saleNum ?? listPrice) * 4)}원
          </span>
        </span>
        {saleNum === null && <span className="text-xs text-amber-600">기표가 기준</span>}
      </div>

      {/* ⭐ 스태거드(앞뒤 규격이 다른 차) 대응 — 담아두면 다시 검색해도 안 사라진다 */}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            addToCompare({
              productId,
              model,
              spec,
              brandName,
              listPrice,
              salePrice: saleNum ?? listPrice,
              qty,
              unit,
            })
          }
          className="flex-1 rounded-lg border border-slate-400 py-2.5 text-sm font-semibold text-slate-700 active:bg-slate-100"
        >
          담기
        </button>
      </div>
    </div>
  );
}
