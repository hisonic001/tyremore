"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { savePriceRule } from "@/lib/pricing";
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
 */
export function PriceTool({
  productId,
  cai,
  model,
  spec,
  brandName,
  listPrice,
  salesRate,
  unit,
}: {
  productId: number;
  cai: string | null;
  model: string;
  spec: string | null;
  brandName: string | null;
  listPrice: number;
  salesRate: number | null;
  unit: string;
}) {
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [rate, setRate] = useState(salesRate !== null ? String(Math.round(salesRate * 1000) / 10) : "");
  const [sale, setSale] = useState(salesRate !== null ? String(Math.round(listPrice * (1 - salesRate))) : "");
  const [qty, setQty] = useState(1);

  /**
   * ⭐ 저장 버튼을 없앴다 (사장님 지시 2026-08-01).
   *    입력을 멈추면 잠시 뒤 **이 상품에만** 자동 저장된다.
   *    타자 칠 때마다 저장하면 중간값(2 → 25 의 "2")까지 저장되므로 잠깐 기다린다.
   *    ⚠️ 모델·브랜드 단위로 넓게 저장하는 것은 상세 화면(/stock/[id])에 남겨 두었다.
   *       목록에서 무심코 누른 값이 브랜드 전체에 퍼지면 되돌리기 어렵다.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function autoSave(nextRate: number | null) {
    if (!cai) return; // 자체 등록품은 개별 저장 대상이 없다
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      start(async () => {
        setError(null);
        const r = await savePriceRule({ scope: "item", target: cai, salesRate: nextRate, productId });
        if (!r.ok) setError(r.error);
        else {
          setSaved(true);
          setTimeout(() => setSaved(false), 1200);
        }
      });
    }, 900);
  }

  /** 할인율 → 판매가 */
  function onRate(v: string) {
    const c = v.replace(/[^\d.]/g, "");
    setRate(c);
    if (c === "" || Number.isNaN(Number(c))) {
      setSale("");
      autoSave(null);
      return;
    }
    setSale(String(Math.round(listPrice * (1 - Number(c) / 100))));
    autoSave(Number(c) / 100);
  }
  /** 판매가 → 할인율 */
  function onSale(v: string) {
    const c = v.replace(/\D/g, "");
    setSale(c);
    if (c === "" || listPrice <= 0) {
      setRate("");
      autoSave(null);
      return;
    }
    const r = 1 - Number(c) / listPrice;
    setRate(String(Math.round(r * 1000) / 10));
    autoSave(r);
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

        {/* 수량 — 기본 1본 */}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className={BTN} onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <input
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
            inputMode="numeric"
            aria-label="수량"
            className="tabular h-11 w-12 rounded-lg border border-slate-300 text-center text-lg font-bold"
          />
          <span className="w-4 text-sm text-slate-500">{unit}</span>
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

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

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
        {saved && <span className="text-xs text-emerald-600">저장됨 ✓</span>}
      </div>
    </div>
  );
}
