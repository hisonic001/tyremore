"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hideUnpricedTires, restoreProducts, setBrandHandled } from "@/lib/catalog";

export function BrandToggle({
  b,
}: {
  b: { code: string; nameKo: string; isHandled: boolean; total: number; visible: number; inStock: number };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold ${b.isHandled ? "" : "text-slate-400"}`}>{b.nameKo}</span>
          {b.inStock > 0 && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
              재고 {b.inStock}종
            </span>
          )}
        </div>
        <div className="tabular text-xs text-slate-500">
          {b.total.toLocaleString()}종 중 {b.visible.toLocaleString()}종 표시
        </div>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setBrandHandled(b.code, !b.isHandled);
            router.refresh();
          })
        }
        aria-label={`${b.nameKo} 취급 ${b.isHandled ? "끄기" : "켜기"}`}
        className={`h-9 w-16 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          b.isHandled ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <span
          className={`block h-7 w-7 rounded-full bg-white transition-transform ${
            b.isHandled ? "translate-x-8" : "translate-x-1"
          }`}
        />
      </button>
    </li>
  );
}

const REASON_LABEL: Record<string, string> = {
  no_price: "기표가가 없어 견적을 못 내는 상품",
  manual: "직접 숨긴 상품",
};

export function BulkActions({ hidden }: { hidden: { reason: string; n: number }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<string>) =>
    start(async () => {
      setMsg(await fn());
      router.refresh();
    });

  return (
    <section className="mt-4 space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">가격 없는 상품 치우기</h2>
        <p className="mt-1 text-sm text-slate-500">
          기표가가 없으면 <strong>견적 금액이 안 나옵니다.</strong> 상담에 쓸 수 없는 상품입니다.
          <br />
          재고가 있는 상품은 건드리지 않습니다.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await hideUnpricedTires();
              return `${r.hidden.toLocaleString()}종을 숨겼습니다`;
            })
          }
          className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : "가격 없는 타이어 숨기기"}
        </button>
      </div>

      {hidden.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">숨긴 상품 되살리기</h2>
          <ul className="mt-2 space-y-2">
            {hidden.map((h) => (
              <li key={h.reason} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-600">
                  {REASON_LABEL[h.reason] ?? h.reason}
                  <span className="tabular ml-2 font-semibold text-slate-900">{h.n.toLocaleString()}종</span>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await restoreProducts(h.reason as "no_price" | "manual");
                      return `${r.restored.toLocaleString()}종을 되살렸습니다`;
                    })
                  }
                  className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
                >
                  되살리기
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{msg}</p>}
    </section>
  );
}
