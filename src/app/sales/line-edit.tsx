"use client";

/**
 * ⭐ 정비 내역 — 품목 줄 수정·삭제·추가 (사장님 요청 2026-08-05 "수정도 더 자유롭게")
 *
 * 전에는 「틀렸으면 취소하고 다시 등록」뿐이었다. 이제 줄 하나를 바로 고친다.
 * 재고는 서버가 따라 맞춘다 — 수량이 늘면 더 빠지고, 줄면 되살아난다.
 * MARS 전송완료 건을 고치면 경고가 돌아온다 (금액이 MARS 와 어긋난다).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSaleLine, removeSaleLine, updateSaleLine } from "@/lib/sale-edit";
import { findServices } from "@/lib/sale";
import { searchProducts } from "@/lib/search-actions";
import type { ProductHit } from "@/lib/search";
import type { SaleLine } from "@/lib/sale-history";

const won = (n: number) => n.toLocaleString("ko-KR");

export function EditableLine({ line: l, onMessage }: { line: SaleLine; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(l.qty);
  const [price, setPrice] = useState(String(l.finalPrice));

  const save = () =>
    start(async () => {
      const r = await updateSaleLine({ itemId: l.itemId, qty, unitPrice: Number(price) || 0 });
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(
        `고쳤습니다.${r.shortage > 0 ? ` ⚠️ 재고가 ${r.shortage}본 모자랍니다.` : ""}${r.marsWarning ? ` ⚠️ ${r.marsWarning}` : ""}`,
      );
      setEditing(false);
      router.refresh();
    });

  const remove = () => {
    if (!confirm(`「${l.description}」 줄을 지울까요? 재고는 되살아납니다.`)) return;
    start(async () => {
      const r = await removeSaleLine(l.itemId);
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(`지웠습니다 — 재고 ${r.restored}개 복원.${r.marsWarning ? ` ⚠️ ${r.marsWarning}` : ""}`);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <li className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">
          {l.lineType === "service" && <span className="mr-1 text-xs text-slate-400">공임</span>}
          {l.description}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="tabular text-slate-600">
            {l.qty > 1 && `${l.qty} × `}
            {won(l.finalPrice)}원
          </span>
          {l.qty > 1 && <span className="tabular text-xs text-slate-400">= {won(l.qty * l.finalPrice)}원</span>}
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-slate-400 underline">
            고치기
          </button>
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-lg bg-slate-50 p-2">
      <div className="truncate text-sm font-medium">{l.description}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg font-bold"
          >
            −
          </button>
          <span className="tabular w-9 text-center font-bold">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="h-9 w-9 rounded-lg border border-slate-300 bg-white text-lg font-bold"
          >
            +
          </button>
        </div>
        <label className="ml-auto flex items-center gap-1">
          <input
            value={price === "" ? "" : Number(price).toLocaleString()}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            className="tabular h-9 w-28 rounded-lg border border-slate-300 px-2 text-right text-sm"
          />
          <span className="text-xs text-slate-500">원</span>
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
        >
          줄 지우기
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(false)}
          className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </li>
  );
}

/** 품목 추가 — 타이어(상품 검색) 또는 공임(서비스 검색) */
export function AddLine({ quoteId, onMessage }: { quoteId: number; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<null | "tire" | "service">(null);
  const [q, setQ] = useState("");
  const [tires, setTires] = useState<ProductHit[]>([]);
  const [svcs, setSvcs] = useState<Awaited<ReturnType<typeof findServices>>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (open === "tire") {
        if (!q.trim()) return setTires([]);
        void searchProducts(q).then((r) => setTires(r.slice(0, 6)));
      } else {
        void findServices(q).then((r) => setSvcs(r.slice(0, 6)));
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const add = (input: Parameters<typeof addSaleLine>[0]) =>
    start(async () => {
      const r = await addSaleLine(input);
      if (!r.ok) return onMessage(`⚠️ ${r.error}`);
      onMessage(
        `담았습니다.${r.shortage > 0 ? ` ⚠️ 재고가 ${r.shortage}본 모자랍니다.` : ""}${r.marsWarning ? ` ⚠️ ${r.marsWarning}` : ""}`,
      );
      setOpen(null);
      setQ("");
      router.refresh();
    });

  if (!open) {
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen("tire")}
          className="flex-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-xs text-slate-500"
        >
          + 타이어·부품 추가
        </button>
        <button
          type="button"
          onClick={() => setOpen("service")}
          className="flex-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-xs text-slate-500"
        >
          + 공임·정비 추가
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={open === "tire" ? "규격·모델명  예: 2454518" : "공임 이름  예: 펑크"}
        autoFocus
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <ul className="mt-1.5 space-y-1">
        {open === "tire"
          ? tires.map((h) => (
              <li key={h.productId}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    add({
                      quoteId,
                      kind: "tire",
                      productId: h.productId,
                      description: h.model,
                      qty: 1,
                      unitPrice: h.salePrice ?? h.listPrice ?? 0,
                    })
                  }
                  className="w-full rounded-lg bg-white px-3 py-1.5 text-left text-sm active:bg-slate-100"
                >
                  <span className="font-medium">{h.model}</span>
                  <span className="tabular ml-2 text-xs text-slate-500">
                    {h.spec} · {won(h.salePrice ?? h.listPrice ?? 0)}원
                  </span>
                </button>
              </li>
            ))
          : svcs.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    add({
                      quoteId,
                      kind: "service",
                      serviceItemId: s.id,
                      description: s.name,
                      qty: 1,
                      unitPrice: s.price ?? 0,
                    })
                  }
                  className="w-full rounded-lg bg-white px-3 py-1.5 text-left text-sm active:bg-slate-100"
                >
                  <span className="font-medium">{s.name}</span>
                  {s.price !== null && <span className="tabular ml-2 text-xs text-slate-500">{won(s.price)}원</span>}
                </button>
              </li>
            ))}
      </ul>
      <button type="button" onClick={() => setOpen(null)} className="mt-1.5 text-xs text-slate-500 underline">
        닫기
      </button>
    </div>
  );
}
