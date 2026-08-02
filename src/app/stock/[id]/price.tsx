"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPriceRule, savePriceRule, type PriceInfo, type RuleScope } from "@/lib/pricing";

const won = (n: number) => n.toLocaleString();

/**
 * ⭐ 할인율 ↔ 판매가 양방향 입력 (D-05 3번)
 * 정비사는 "25% 빼줘"라고도, "18만 9천"이라고도 생각한다. 어느 쪽을 넣어도 된다.
 */
export function PricePanel({
  productId,
  price,
  ownerMode,
}: {
  productId: number;
  price: PriceInfo;
  ownerMode: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const list = price.listPrice;
  const [rate, setRate] = useState(price.salesRate !== null ? String(Math.round(price.salesRate * 1000) / 10) : "");
  const [sale, setSale] = useState(price.salePrice !== null ? String(price.salePrice) : "");
  const [pRate, setPRate] = useState(
    price.purchaseRate !== null ? String(Math.round(price.purchaseRate * 1000) / 10) : "",
  );
  const [scope, setScope] = useState<RuleScope>(price.appliedScope ?? "item");

  if (list === null) {
    return (
      <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="font-medium text-amber-900">기표가가 없어 가격을 계산할 수 없습니다</p>
        <p className="mt-1 text-sm text-amber-800">
          MARS에 정가가 등록되지 않은 상품입니다. 견적을 내려면 금액을 직접 넣어야 합니다.
        </p>
      </section>
    );
  }

  /** 할인율을 넣으면 판매가가 따라온다 */
  function onRate(v: string) {
    const clean = v.replace(/[^\d.]/g, "");
    setRate(clean);
    const n = Number(clean);
    if (clean === "" || Number.isNaN(n)) return setSale("");
    setSale(String(Math.round(list! * (1 - n / 100))));
  }

  /** 판매가를 넣으면 할인율이 따라온다 */
  function onSale(v: string) {
    const clean = v.replace(/\D/g, "");
    setSale(clean);
    const n = Number(clean);
    if (clean === "" || Number.isNaN(n) || list! <= 0) return setRate("");
    setRate(String(Math.round((1 - n / list!) * 1000) / 10));
  }

  const rateNum = rate === "" ? null : Number(rate) / 100;
  const saleNum = sale === "" ? null : Number(sale);
  const pRateNum = pRate === "" ? null : Number(pRate) / 100;

  // 매입원가는 VAT 미포함 기준(공장도가)이다
  const cost =
    pRateNum !== null && price.listPriceExcl !== null
      ? Math.round(price.listPriceExcl * (1 - pRateNum))
      : null;
  // ⚠️ 공급가액끼리 비교한다
  const margin = saleNum !== null && cost !== null ? Math.round(saleNum / 1.1 - cost) : null;

  const dirty =
    rateNum !== price.salesRate ||
    (pRateNum ?? null) !== (price.purchaseRate ?? null);

  const save = () =>
    start(async () => {
      setError(null);
      const target = price.scopes.find((s) => s.scope === scope)?.target;
      if (!target) return setError("저장 범위를 고를 수 없습니다");
      const r = await savePriceRule({
        scope,
        target,
        salesRate: rateNum,
        purchaseRate: pRateNum,
        productId,
      });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  return (
    <section className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-bold">가격</h2>
        {price.appliedScope && (
          <span className="text-xs text-slate-400">
            {price.scopes.find((s) => s.scope === price.appliedScope)?.label ?? price.appliedScope} 규칙 적용 중
          </span>
        )}
      </div>

      <dl className="tabular mt-3 flex items-baseline justify-between">
        <dt className="text-slate-500">기표가</dt>
        <dd className="text-lg">
          {won(list)}원 <span className="text-xs text-slate-400">VAT 포함</span>
        </dd>
      </dl>

      {/* ⭐ 어느 칸에 넣어도 나머지가 따라온다 */}
      <div className="mt-3 space-y-2">
        <Row label="할인율">
          <input
            value={rate}
            onChange={(e) => onRate(e.target.value)}
            inputMode="decimal"
            placeholder="미설정"
            className="tabular h-14 w-28 rounded-xl border-2 border-slate-300 px-3 text-right text-2xl font-bold outline-none focus:border-slate-900"
          />
          <span className="w-8 text-lg text-slate-500">%</span>
        </Row>
        <Row label="판매가">
          <input
            value={sale === "" ? "" : Number(sale).toLocaleString()}
            onChange={(e) => onSale(e.target.value)}
            inputMode="numeric"
            placeholder="미설정"
            className="tabular h-14 w-36 rounded-xl border-2 border-slate-300 px-3 text-right text-2xl font-bold outline-none focus:border-slate-900"
          />
          <span className="w-8 text-lg text-slate-500">원</span>
        </Row>
      </div>

      {saleNum !== null && (
        <p className="tabular mt-2 text-right text-sm text-slate-500">
          4본 <span className="font-semibold text-slate-800">{won(saleNum * 4)}원</span>
        </p>
      )}

      {/* 사장님 전용 — 매입원가·마진 (D-05 6번) */}
      {ownerMode && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            사장님만 보입니다
          </div>
          <Row label="매입 할인율">
            <input
              value={pRate}
              onChange={(e) => setPRate(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="미설정"
              className="tabular h-12 w-24 rounded-lg border border-slate-300 px-3 text-right text-lg outline-none focus:border-slate-900"
            />
            <span className="w-8 text-slate-500">%</span>
          </Row>
          <dl className="tabular mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">매입 원가</dt>
              <dd>{cost !== null ? `${won(cost)}원` : "—"} <span className="text-xs text-slate-400">VAT 별도</span></dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1">
              <dt className="text-slate-500">마진 (공급가 기준)</dt>
              <dd className={margin !== null && margin < 0 ? "font-bold text-red-600" : "font-bold"}>
                {margin !== null ? `${won(margin)}원` : "—"}
                {margin !== null && saleNum ? (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    {Math.round((margin / (saleNum / 1.1)) * 1000) / 10}%
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* 저장 범위 — 넓게 저장할수록 다음부터 자동으로 나온다 */}
      {dirty && (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <p className="mb-2 text-sm font-medium text-slate-700">어디에 저장할까요?</p>
          <div className="flex flex-wrap gap-2">
            {price.scopes.map((s) => (
              <button
                key={s.scope}
                type="button"
                onClick={() => setScope(s.scope)}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  scope === s.scope
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-600"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="mt-3 w-full rounded-xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {!dirty && price.appliedScope && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await clearPriceRule(price.appliedScope!, price.appliedTarget!, productId);
              setRate("");
              setSale("");
              setPRate("");
              router.refresh();
            })
          }
          className="mt-3 w-full rounded-xl border border-slate-300 py-2 text-sm text-slate-500"
        >
          할인율 지우기
        </button>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
