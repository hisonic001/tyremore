"use client";

/**
 * ⭐ 중복 상품 합치기 화면 (사장님 승인 2026-08-05 — 품목 정리 ②)
 *
 * 묶음마다 대표를 고르고(추천이 미리 골라져 있다) 「합치기」를 누르면
 * 나머지의 재고·판매·매입·거래처 사전이 대표로 옮겨지고 나머지는 지워진다.
 * 흡수된 품번은 거래처 사전에 남아 다음 인보이스가 다시 만들지 않는다.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeProducts, type DupGroup } from "@/lib/product-merge";
import { useConfirm } from "@/components/ui/confirm";

const won = (n: number | null) => (n === null ? "—" : n.toLocaleString());

export function DupList({ groups }: { groups: DupGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
        중복이 없습니다 🎉
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-500">
        같은 타이어가 상품 여러 개로 갈라진 묶음 {groups.length}개.
        대표(⭐ 추천이 미리 골라져 있습니다)를 확인하고 합치세요 — 재고·이력은 전부 대표로 옮겨집니다.
      </p>
      {groups.map((g) => (
        <Group key={g.label + g.products[0]?.id} g={g} />
      ))}
    </div>
  );
}

function Group({ g }: { g: DupGroup }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm(); // 배치4 — confirm() 대체
  const [keepId, setKeepId] = useState<number>(g.products.find((p) => p.suggested)?.id ?? g.products[0].id);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const absorb = g.products.filter((p) => p.id !== keepId);

  if (result) {
    return (
      <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        ✅ {g.label} — 합쳤습니다 ({result})
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h3 className="font-bold">{g.label}</h3>
      <div className="mt-2 space-y-1.5">
        {g.products.map((p) => (
          <label
            key={p.id}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
              p.id === keepId ? "border-slate-900 bg-slate-50" : "border-slate-200"
            }`}
          >
            <input
              type="radio"
              name={`keep-${g.products[0].id}`}
              checked={p.id === keepId}
              onChange={() => setKeepId(p.id)}
              className="h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {p.marsItemNo ?? "(품번 없음)"}
                {p.suggested && <span className="ml-1.5 text-xs text-amber-600">⭐ 추천</span>}
                {!p.isActive && <span className="ml-1.5 text-xs text-slate-400">(숨김)</span>}
              </div>
              <div className="tabular text-xs text-slate-500">
                재고 {p.stockQty}본 · 판매 {p.saleCount}건 · 매입 {p.purchaseCount}건 · 사전 {p.dictCount}건 · 기표가{" "}
                {won(p.listPrice)}
              </div>
            </div>
            <span className={`shrink-0 text-xs font-semibold ${p.id === keepId ? "text-slate-900" : "text-slate-400"}`}>
              {p.id === keepId ? "대표" : "→ 대표로 흡수"}
            </span>
          </label>
        ))}
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (
            !(await ask({
              title: "대표로 합칠까요?",
              body: `${g.label}\n\n${absorb.map((p) => p.marsItemNo ?? `#${p.id}`).join(", ")} — 재고·판매·매입 이력이 전부 대표로 옮겨지고, 흡수된 상품은 지워집니다.`,
              confirmLabel: "합치기",
            }))
          )
            return;
          start(async () => {
            setError(null);
            const r = await mergeProducts(
              keepId,
              absorb.map((p) => p.id),
            );
            if (!r.ok) {
              setError(r.error);
              return;
            }
            setResult(r.moved);
            router.refresh();
          });
        }}
        className="mt-2.5 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "합치는 중…" : `이 ${absorb.length}개를 대표로 합치기`}
      </button>
      {confirmDialog}
    </section>
  );
}
