"use client";

/**
 * ⭐ 붙여넣기로 매입 담기 (사장님 요청 2026-08-15)
 *    거래처 주문서 화면을 그대로 복사해 붙이면 읽어서 재고에 넣는다.
 *    사장님 결정: 물건이 도착했을 때 붙여넣는다 → 바로 입고 · 매입가도 갱신.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewPastedPurchase,
  savePastedPurchase,
  linkPastedCode,
  type PastePreview,
  type MatchedLine,
} from "@/lib/purchase-paste-actions";
import { searchProducts } from "@/lib/search-actions";
import type { ProductHit } from "@/lib/search";

const won = (n: number) => n.toLocaleString() + "원";

export function PastePurchase({ suppliers }: { suppliers: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("나이스 오토파츠");
  const [text, setText] = useState("");
  const [pv, setPv] = useState<PastePreview | null>(null);
  const [qtyEdit, setQtyEdit] = useState<Record<number, number>>({});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setText("");
    setPv(null);
    setQtyEdit({});
    setErr(null);
  };

  const doPreview = () =>
    start(async () => {
      setErr(null);
      setMsg(null);
      const r = await previewPastedPurchase(text, supplier);
      if (r.lines.length === 0) {
        setErr("읽을 수 있는 품목이 없습니다 — 주문서의 품목 부분을 통째로 복사해 보세요");
        setPv(null);
        return;
      }
      setPv(r);
    });

  const save = () =>
    start(async () => {
      if (!pv) return;
      setErr(null);
      const lines = pv.lines
        .filter((l) => l.productId)
        .map((l, i) => ({
          productId: l.productId!,
          code: l.code,
          name: l.name || l.productName || l.code,
          qty: qtyEdit[i] ?? l.qty,
          unitCost: l.unitCost,
        }));
      const r = await savePastedPurchase({ supplier, lines, rawText: text });
      if (!r.ok) return setErr(r.error);
      setMsg(
        `✅ ${r.received}개 입고했습니다${r.priceUpdated > 0 ? ` · 매입가 ${r.priceUpdated}종 갱신` : ""}`,
      );
      reset();
      router.refresh();
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600"
      >
        📋 붙여넣기로 매입 담기 (나이스 오토파츠 등)
      </button>
    );
  }

  const unmatched = pv?.lines.filter((l) => !l.productId).length ?? 0;

  return (
    <section className="mt-3 rounded-2xl border border-slate-300 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">붙여넣기로 매입 담기</h2>
        <button type="button" onClick={() => { setOpen(false); reset(); }} className="text-sm text-slate-400">
          닫기
        </button>
      </div>

      {msg && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      <label className="mt-3 block text-sm font-medium text-slate-700">거래처</label>
      <input
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
        list="paste-suppliers"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
      <datalist id="paste-suppliers">
        {["나이스 오토파츠", ...suppliers].map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {!pv && (
        <>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            주문서·장바구니 화면을 복사해서 붙여넣으세요
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"[오일 필터]그랜드카니발R/스포티지R/…\n품번 : 26320-2F000\n\n나이스번호 : MBB-023\n\n5    2,750원    13,750원    선불"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-slate-500">
            나이스 오토파츠 형식은 그대로 읽습니다. 다른 거래처는 엑셀·표를 복사해도 되고,
            <strong> 품번·수량·단가</strong>가 한 줄에 있으면 읽습니다.
          </p>
          <button
            type="button"
            disabled={pending || !text.trim()}
            onClick={doPreview}
            className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-semibold text-white disabled:opacity-50"
          >
            {pending ? "읽는 중…" : "읽어서 확인하기"}
          </button>
        </>
      )}

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {pv && (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium">{pv.format} 형식</span>
            <span>
              {pv.lines.length}줄 · 이어짐 <strong className="text-emerald-700">{pv.matched}</strong>
              {unmatched > 0 && <strong className="ml-1 text-red-600">· 못 이음 {unmatched}</strong>}
            </span>
            <span className="tabular ml-auto text-slate-600">
              {pv.totalQty}개 · {won(pv.totalAmount)}
            </span>
          </div>
          {pv.skipped.map((s) => (
            <p key={s} className="mt-1 text-xs text-amber-700">⚠️ {s}</p>
          ))}

          <ul className="mt-3 divide-y divide-slate-100">
            {pv.lines.map((l, i) => (
              <PasteRow
                key={`${l.code}-${i}`}
                l={l}
                supplier={supplier}
                qty={qtyEdit[i] ?? l.qty}
                onQty={(n) => setQtyEdit((q) => ({ ...q, [i]: n }))}
                onLinked={(pid, name) => {
                  setPv((prev) =>
                    prev
                      ? {
                          ...prev,
                          matched: prev.matched + 1,
                          lines: prev.lines.map((x, j) =>
                            j === i ? { ...x, productId: pid, productName: name, matchedBy: "거래처 사전" } : x,
                          ),
                        }
                      : prev,
                  );
                }}
              />
            ))}
          </ul>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-600"
            >
              다시 붙여넣기
            </button>
            <button
              type="button"
              disabled={pending || pv.matched === 0}
              onClick={save}
              className="flex-1 rounded-xl bg-emerald-700 py-3 font-semibold text-white disabled:opacity-50"
            >
              {pending ? "저장 중…" : `${pv.matched}줄 입고하기 (재고에 바로 반영)`}
            </button>
          </div>
          {unmatched > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              못 이은 {unmatched}줄은 담기지 않습니다. 상품을 골라 주시면 다음부터 이 거래처의 같은
              품번은 저절로 이어집니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PasteRow({
  l,
  supplier,
  qty,
  onQty,
  onLinked,
}: {
  l: MatchedLine;
  supplier: string;
  qty: number;
  onQty: (n: number) => void;
  onLinked: (productId: number, name: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [pending, start] = useTransition();

  const priceChanged = l.productId && l.unitCost && l.oldCost !== null && l.oldCost !== l.unitCost;

  return (
    <li className="py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="tabular text-sm font-semibold">{l.code}</span>
            {l.productId ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                {l.matchedBy}
              </span>
            ) : (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">못 이음</span>
            )}
            {l.isPart && <span className="text-[11px] text-slate-400">부품</span>}
          </div>
          <div className="truncate text-xs text-slate-500">{l.productName ?? l.name}</div>
          {l.productId && (
            <div className="tabular text-[11px] text-slate-400">
              지금 재고 {l.stockQty}개 → {l.stockQty + qty}개
              {priceChanged && (
                <span className="ml-1.5 text-amber-700">
                  · 매입가 {l.oldCost!.toLocaleString()} → {l.unitCost!.toLocaleString()}원
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <input
            value={qty}
            onChange={(e) => onQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
            inputMode="numeric"
            className="tabular h-8 w-14 rounded-lg border border-slate-300 px-2 text-right text-sm"
          />
          <div className="tabular mt-0.5 text-[11px] text-slate-500">
            {l.unitCost ? `${l.unitCost.toLocaleString()}원` : "단가 없음"}
          </div>
        </div>
      </div>

      {!l.productId && (
        <div className="mt-1.5">
          {!picking ? (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
            >
              + 상품 고르기 (한 번만 고르면 기억합니다)
            </button>
          ) : (
            <div>
              <input
                value={q}
                autoFocus
                onChange={(e) => {
                  const v = e.target.value;
                  setQ(v);
                  if (v.trim().length >= 2) {
                    void searchProducts(v, { includeHidden: true }).then((r) => setHits(r.slice(0, 6)));
                  }
                }}
                placeholder="품번·차종으로 찾기"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <ul className="mt-1 space-y-1">
                {hits.map((h) => (
                  <li key={h.productId}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await linkPastedCode({
                            supplier,
                            code: l.code,
                            productId: h.productId,
                            supplierName: l.name,
                          });
                          if (r.ok) {
                            onLinked(h.productId, h.model);
                            setPicking(false);
                          }
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-xs active:bg-slate-100"
                    >
                      <span className="font-medium">{h.model}</span>
                      {h.partNo && <span className="tabular ml-1 text-slate-400">{h.partNo}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setPicking(false)} className="mt-1 text-xs text-slate-400">
                취소
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
