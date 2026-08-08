"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeInvoice,
  startManualPurchase,
  updatePurchaseItem,
  type PendingInvoice,
} from "@/lib/invoice";
import { ProductPicker } from "./product-picker";
import { SupplierInput } from "./supplier-input";

const won = (n: number) => n.toLocaleString();

/**
 * ⭐ 직접 매입 (사장님 요청 2026-08-01)
 *
 * 본사 발주가 아니라 거래처에서 여러 브랜드를 사 오는 경우.
 * 인보이스 엑셀이 없으므로 **품목을 검색해 목록을 만들어 간다.**
 *
 * 🔴 2026-08-04 — 바코드로 담는 길을 걷어냈다 (사장님: "써보니 생각보다 불편하다").
 *    전에는 「바코드로 담기 / 품목 검색으로 담기」를 고르게 했는데, 이제 검색 하나다.
 *    라벨이 떨어졌거나 거래처가 아예 안 붙여 보내는 경우가 흔해 검색이 어차피 주 경로였다.
 *
 * 장부는 인보이스와 같은 구조로 남긴다 — 매입 내역·원가 추적이 한 곳에서 이어져야 한다.
 */
export function ManualPurchase({
  open,
  owner,
}: {
  open: PendingInvoice | null;
  /** 매입가 입력·표시는 사장님만 (D-05, 2026-08-08 코드 리뷰) */
  owner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplier, setSupplier] = useState("");
  const [error, setError] = useState<string | null>(null);

  function begin() {
    start(async () => {
      setError(null);
      const r = await startManualPurchase(supplier);
      if (!r.ok) setError(r.error);
      else {
        setSupplier("");
        router.refresh();
      }
    });
  }

  if (!open) {
    const ready = !pending && supplier.trim().length > 0;
    return (
      <section className="mt-5 rounded-2xl border border-slate-300 bg-white p-4">
        <h2 className="font-bold">직접 매입</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          거래처에서 사 오신 타이어를 등록합니다. 인보이스가 없어도 됩니다.
        </p>

        <form className="mt-3" onSubmit={(e) => e.preventDefault()}>
          {/* ⭐ 같은 거래처가 두 이름으로 갈리지 않게 치는 동안 보여준다 */}
          <SupplierInput value={supplier} onChange={setSupplier} />

          <button
            type="button"
            disabled={!ready}
            onClick={begin}
            className="mt-3 w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white active:bg-slate-700 disabled:opacity-40"
          >
            장부 시작하기
          </button>
          <p className="mt-2 text-xs text-slate-500">
            거래처를 먼저 적어 주세요. 시작하면 품목을 검색해 담습니다.
          </p>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return <ManualLedger inv={open} owner={owner} />;
}

function ManualLedger({ inv, owner }: { inv: PendingInvoice; owner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const total = inv.lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.qty, 0);

  return (
    <section className="mt-5 rounded-2xl border-2 border-indigo-600 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-indigo-900">
          직접 매입 — {inv.supplier}
          <span className="tabular ml-2 text-sm font-normal text-indigo-700">{inv.invoiceNo}</span>
        </h2>
        <span className="tabular text-sm text-indigo-800">
          {inv.lines.reduce((s, l) => s + l.qty, 0)}본
          {total > 0 && ` · ${won(total)}원`}
        </span>
      </div>
      <p className="mt-2 text-sm text-indigo-800">
        규격이나 모델로 찾아 담으세요. <strong>여러 품목을 이어서 담을 수 있습니다.</strong>
      </p>
      <ProductPicker invoiceId={inv.invoiceId} tone="indigo" />

      {/* 담긴 목록 — 수량과 매입가를 여기서 정한다 */}
      {inv.lines.length > 0 && (
        <ul className="mt-3 space-y-2">
          {inv.lines.map((l) => (
            <ManualRow key={l.itemId} line={l} owner={owner} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-indigo-700">
        {owner
          ? "매입가는 나중에 넣어도 됩니다. 비워 두면 원가·마진만 안 나옵니다. "
          : "매입가는 사장님 계정에서 넣습니다. "}
        아래 「입고 예정」에서 <strong>전량 입고</strong>를 누르면 재고가 됩니다.
      </p>

      {/* 잘못 열었거나 그만둘 때 — 이게 없으면 빈 장부가 화면을 계속 차지한다 */}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await removeInvoice(inv.invoiceId);
            router.refresh();
          })
        }
        className="mt-2 w-full rounded-lg border border-indigo-300 bg-white py-2 text-sm text-indigo-700"
      >
        {inv.lines.length === 0 ? "그만두기" : "이 장부 지우기"}
      </button>

      {pending && <p className="mt-1 text-sm text-indigo-700">처리 중…</p>}
    </section>
  );
}

function ManualRow({ line, owner }: { line: PendingInvoice["lines"][number]; owner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(line.qty);
  const [cost, setCost] = useState(line.unitCost ? String(line.unitCost) : "");

  const save = (next: { qty?: number; unitCost?: number | null }) =>
    start(async () => {
      await updatePurchaseItem({ itemId: line.itemId, ...next });
      router.refresh();
    });

  const BTN = "h-10 w-10 shrink-0 rounded-lg border border-indigo-300 bg-white text-lg font-bold";

  return (
    <li className="rounded-lg bg-white p-2">
      <div className="truncate text-sm font-medium">{line.model ?? line.description}</div>
      <div className="tabular text-xs text-slate-500">{[line.spec, line.cai].filter(Boolean).join(" · ")}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const v = Math.max(1, qty - 1);
              setQty(v);
              save({ qty: v });
            }}
          >
            −
          </button>
          <span className="tabular w-10 text-center font-bold">{qty}본</span>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const v = qty + 1;
              setQty(v);
              save({ qty: v });
            }}
          >
            +
          </button>
        </div>
        {/* 🔴 매입가 칸은 사장님만 — 정비사 화면에 있으면 값이 보이고, 지운 채 저장하면 덮어써진다 */}
        {owner && (
          <label className="ml-auto flex items-center gap-1">
            <span className="text-xs text-slate-500">본당</span>
            <input
              value={cost === "" ? "" : Number(cost).toLocaleString()}
              onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))}
              onBlur={() => save({ qty, unitCost: cost === "" ? null : Number(cost) })}
              inputMode="numeric"
              placeholder="매입가"
              className="tabular h-10 w-28 rounded-lg border border-indigo-300 px-2 text-right"
            />
            <span className="text-xs text-slate-500">원</span>
          </label>
        )}
      </div>
      {pending && <span className="text-xs text-slate-400">저장 중…</span>}
    </li>
  );
}
