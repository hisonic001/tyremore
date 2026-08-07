"use client";

import Link from "@/lib/link";
import { useEffect, useRef, useState } from "react";
import { searchProducts } from "@/lib/search-actions";
import type { ProductHit } from "@/lib/search";

/**
 * ⭐ 등록하기 전에 먼저 찾아본다 (사장님 요청 2026-08-01)
 *
 * MARS 마스터에 10,955건이 있다. 새로 만들려는 상품이 이미 있을 확률이 훨씬 높고,
 * 중복으로 만들면 재고가 두 군데로 갈라져 나중에 못 합친다.
 *
 * 규격과 모델명을 섞어 칠 수 있다 — `2454518` · `2454518 primacy`.
 * 미쉐린 주문 사이트와 같은 모양으로 보여준다: 전체 표기 / CAI / 재고 / 모델 | 인치 | 하중 | 속도
 */
export function ProductLookup({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 늦게 도착한 옛 응답이 새 결과를 덮어쓰지 않게 한다 */
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const my = ++seq.current;
      try {
        const r = await searchProducts(term, { includeHidden: true });
        if (my === seq.current) setHits(r.slice(0, 12));
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <section className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-4">
      <h2 className="font-bold">먼저 찾아보세요</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        대부분 이미 등록돼 있습니다. 중복으로 만들면 재고가 갈라집니다.
      </p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        autoComplete="off"
        placeholder="2454518  ·  2454518 primacy  ·  405365"
        aria-label="기존 상품 검색"
        className="mt-3 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl outline-none focus:border-slate-900"
      />

      {q.trim().length >= 2 && (
        <p className="mt-2 text-sm text-slate-500">
          {busy ? "찾는 중…" : hits.length > 0 ? `${hits.length}건 찾음` : "없습니다 — 아래에서 새로 등록하세요"}
        </p>
      )}

      {hits.length > 0 && (
        <ul className="mt-2 max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {hits.map((p) => (
            <li key={p.productId}>
              {/* prefetch 금지 — 목록형 링크의 미리 읽기가 풀러를 채운다 (2026-08-07) */}
              <Link prefetch={false} href={`/stock/${p.productId}`} className="block py-2.5 active:bg-slate-50">
                {/* 미쉐린 주문 사이트와 같은 순서로 적는다 */}
                <div className="text-sm font-semibold leading-snug">
                  {[p.spec, p.loadSpeed, p.model].filter(Boolean).join(" ")}
                </div>
                <div className="tabular mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                  {p.cai && <span className="font-semibold text-slate-600">{p.cai}</span>}
                  <StockText p={p} />
                  {p.listPrice && <span className="text-slate-500">{p.listPrice.toLocaleString()}원</span>}
                  {p.isHidden && <span className="text-slate-400">숨김</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {[p.model, p.spec?.split("R")[1], p.loadSpeed?.replace(/[A-Z]+$/, ""), p.loadSpeed?.match(/[A-Z]+$/)?.[0]]
                    .filter(Boolean)
                    .join(" | ")}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StockText({ p }: { p: ProductHit }) {
  const unit = p.itemType === "tire" ? "본" : "개";
  if (!p.stockTracked) return <span className="text-slate-400">미등록</span>;
  if (!p.verified) return <span className="text-slate-400">미확인</span>;
  if (p.stockQty > 0) return <span className="font-semibold text-emerald-700">재고 {p.stockQty}{unit}</span>;
  return <span className="text-red-600">소진</span>;
}
