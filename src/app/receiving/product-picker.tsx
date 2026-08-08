"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProductToPurchase } from "@/lib/invoice";
import { searchProducts } from "@/lib/search-actions";

const won = (n: number) => n.toLocaleString();

interface Hit {
  productId: number;
  model: string;
  spec: string | null;
  loadSpeed: string | null;
  brandName: string | null;
  season: string | null;
  listPrice: number | null;
  stockQty: number;
}

/**
 * ⭐ 품목을 찾아서 매입 장부에 담는다 (사장님 요청 2026-08-03)
 *
 *   "바코드 이외에도 품목 검색을 통해서도 매입 입고가 가능하게 해줬으면 좋겠어.
 *    한 품목이 아니라 여러 품목도 가능했으면 좋겠음."
 *
 * 설계
 *   · 검색 결과가 **닫히지 않는다.** 한 번 찾아서 여러 줄을 잇달아 담을 수 있어야 한다
 *   · 수량 기본값은 **1본** (사장님 지시 2026-08-08 — 4본에서 변경. 매입은 낱개가 잦다)
 *   · 담은 줄에는 「✓ 담김」이 남는다. 뭘 담았는지 눈으로 세지 않아도 되게
 *   · 매입가는 여기서 안 받는다. 아래 목록에서 넣는 자리가 이미 있고,
 *     담는 손을 멈추게 하면 여러 품목을 담기 힘들다
 */
export function ProductPicker({
  invoiceId,
  tone = "indigo",
}: {
  invoiceId: number;
  /** 직접 매입은 indigo, 인보이스 장부는 slate — 화면 맥락에 맞춘다 */
  tone?: "indigo" | "slate";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [added, setAdded] = useState<Record<number, number>>({});
  const [qty, setQty] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  const c =
    tone === "indigo"
      ? { border: "border-indigo-300", focus: "focus:border-indigo-700", btn: "bg-indigo-700", text: "text-indigo-800" }
      : { border: "border-slate-300", focus: "focus:border-slate-900", btn: "bg-slate-900", text: "text-slate-600" };

  function search() {
    const term = q.trim();
    if (!term) return;
    setError(null);
    start(async () => {
      // 단종·미취급도 보여준다 — 거래처에서 실제로 사 오신 물건이다
      const r = await searchProducts(term, { includeHidden: true });
      setHits(
        r.slice(0, 20).map((p) => ({
          productId: p.productId,
          model: p.model,
          spec: p.spec,
          loadSpeed: p.loadSpeed,
          brandName: p.brandName,
          season: p.season,
          listPrice: p.listPrice,
          stockQty: p.stockQty,
        })),
      );
    });
  }

  function add(h: Hit) {
    const n = qty[h.productId] ?? 1;
    setError(null);
    start(async () => {
      const r = await addProductToPurchase({ invoiceId, productId: h.productId, qty: n });
      if (!r.ok) return setError(r.error);
      setAdded((a) => ({ ...a, [h.productId]: r.qty }));
      router.refresh();
    });
  }

  const step = (id: number, d: number) =>
    setQty((s) => ({ ...s, [id]: Math.max(1, (s[id] ?? 1) + d) }));

  return (
    <div className="mt-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          /* ⚠️ 모델명은 MARS 원문 그대로라 **영문**이다. 「크로스클라이밋」으로는 안 나온다.
                브랜드는 한글이 통한다 (미쉐린·금호). 실데이터로 확인함 (2026-08-03) */
          placeholder="규격·모델로 찾기   예: 2254518 · primacy · 미쉐린"
          autoComplete="off"
          className={`min-w-0 flex-1 rounded-lg border-2 ${c.border} bg-white px-3 py-3 text-lg outline-none ${c.focus}`}
        />
        <button
          type="submit"
          disabled={pending || !q.trim()}
          className={`shrink-0 rounded-lg ${c.btn} px-5 font-semibold text-white disabled:opacity-50`}
        >
          찾기
        </button>
      </form>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {pending && hits === null && <p className={`mt-2 text-sm ${c.text}`}>찾는 중…</p>}

      {hits !== null && hits.length === 0 && (
        <p className="mt-2 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm leading-relaxed text-slate-500">
          찾지 못했습니다. 규격만으로 찾아 보세요 — <span className="tabular">2254518</span>
          <br />
          <span className="text-xs">모델명은 영문입니다 (크로스클라이밋 ✕ · CROSSCLIMATE ○)</span>
        </p>
      )}

      {hits !== null && hits.length > 0 && (
        <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto">
          {hits.map((h) => {
            const n = qty[h.productId] ?? 1;
            const done = added[h.productId];
            return (
              <li key={h.productId} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="tabular font-semibold">{h.spec ?? "규격 미상"}</span>
                  {h.loadSpeed && <span className="tabular text-xs text-slate-500">{h.loadSpeed}</span>}
                  {h.season && <span className="text-xs text-slate-500">{h.season}</span>}
                  <span className="tabular ml-auto shrink-0 text-xs text-slate-400">재고 {h.stockQty}본</span>
                </div>
                <div className="truncate text-sm text-slate-700">
                  {h.brandName && <span className="text-slate-400">{h.brandName} </span>}
                  {h.model}
                </div>
                {h.listPrice !== null && (
                  <div className="tabular text-xs text-slate-400">기표가 {won(h.listPrice)}원</div>
                )}

                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => step(h.productId, -1)}
                    className="h-11 w-11 shrink-0 rounded-lg border border-slate-300 text-xl font-bold active:bg-slate-100"
                  >
                    −
                  </button>
                  <span className="tabular w-10 text-center text-lg font-bold">{n}</span>
                  <button
                    type="button"
                    onClick={() => step(h.productId, 1)}
                    className="h-11 w-11 shrink-0 rounded-lg border border-slate-300 text-xl font-bold active:bg-slate-100"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => add(h)}
                    className={`ml-auto rounded-lg ${c.btn} px-5 py-3 font-semibold text-white disabled:opacity-50`}
                  >
                    {done !== undefined ? `✓ ${done}본 담김 · 더` : `${n}본 담기`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
