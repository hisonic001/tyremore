"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePriceRule, type RuleScope } from "@/lib/pricing";

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
  pattern,
  brandCode,
  brandName,
  listPrice,
  salesRate,
  unit,
}: {
  productId: number;
  cai: string | null;
  pattern: string | null;
  brandCode: string | null;
  brandName: string | null;
  listPrice: number;
  salesRate: number | null;
  unit: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rate, setRate] = useState(salesRate !== null ? String(Math.round(salesRate * 1000) / 10) : "");
  const [sale, setSale] = useState(salesRate !== null ? String(Math.round(listPrice * (1 - salesRate))) : "");
  const [qty, setQty] = useState(1);

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
  const rateNum = rate === "" ? null : Number(rate) / 100;
  const changed = rateNum !== salesRate;

  const scopes: { scope: RuleScope; target: string; label: string }[] = [];
  if (cai) scopes.push({ scope: "item", target: cai, label: "이 상품만" });
  if (pattern) scopes.push({ scope: "pattern", target: pattern, label: "이 모델" });
  if (brandCode) scopes.push({ scope: "brand", target: brandCode, label: `${brandName ?? brandCode} 전체` });

  const save = (scope: RuleScope, target: string) =>
    start(async () => {
      setError(null);
      const r = await savePriceRule({ scope, target, salesRate: rateNum, productId });
      if (!r.ok) setError(r.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });

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

      {/* 바꿨으면 저장 — 어디에 적용할지 고른다 (좁은 것이 이긴다) */}
      {changed && (
        <div className="mt-2">
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white"
            >
              이 할인율 저장
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s) => (
                <button
                  key={s.scope}
                  type="button"
                  disabled={pending}
                  onClick={() => save(s.scope, s.target)}
                  className="flex-1 rounded-lg border border-slate-900 px-2 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
              <button type="button" onClick={() => setOpen(false)} className="px-3 text-sm text-slate-400">
                취소
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
