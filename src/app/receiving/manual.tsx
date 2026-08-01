"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkBarcode } from "@/lib/barcode-lookup";
import {
  addScannedToPurchase,
  startManualPurchase,
  updatePurchaseItem,
  type PendingInvoice,
} from "@/lib/invoice";
import { useScanner } from "../use-scanner";

const won = (n: number) => n.toLocaleString();

/**
 * ⭐ 직접 매입 (사장님 요청 2026-08-01)
 *
 * 본사 발주가 아니라 거래처에서 여러 브랜드를 사 오는 경우.
 * 인보이스 엑셀이 없으므로 **바코드를 찍어 목록을 만들어 간다.**
 *
 * 장부는 인보이스와 같은 구조로 남긴다 — 매입 내역·원가 추적이 한 곳에서 이어져야 한다.
 */
export function ManualPurchase({ open }: { open: PendingInvoice | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [supplier, setSupplier] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <section className="mt-5 rounded-2xl border border-slate-300 bg-white p-4">
        <h2 className="font-bold">직접 매입</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          거래처에서 사 오신 타이어는 여기서 바코드를 찍어 등록합니다. 인보이스가 없어도 됩니다.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const r = await startManualPurchase(supplier);
              if (!r.ok) setError(r.error);
              else {
                setSupplier("");
                router.refresh();
              }
            });
          }}
        >
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="거래처 이름"
            className="min-w-0 flex-1 rounded-lg border-2 border-slate-300 px-3 py-3 text-lg outline-none focus:border-slate-900"
          />
          <button
            type="submit"
            disabled={pending}
            className="shrink-0 rounded-lg bg-slate-900 px-5 font-semibold text-white disabled:opacity-50"
          >
            시작
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return <ManualScanning inv={open} />;
}

function ManualScanning({ inv }: { inv: PendingInvoice }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [log, setLog] = useState<{ ok: boolean; text: string; at: number }[]>([]);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = (code: string) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const r = await addScannedToPurchase(inv.invoiceId, code);
      setLog((l) =>
        [
          {
            ok: r.ok,
            text: r.ok ? `✅ ${r.model} → ${r.qty}본 (${r.via})` : `❌ ${r.error}`,
            at: Date.now(),
          },
          ...l,
        ].slice(0, 6),
      );
      setUnknown(!r.ok && r.unknown ? (r.code ?? code) : null);
      setBusy(false);
      if (r.ok) router.refresh();
    })();
  };

  useScanner(handle, !unknown);

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
      <p className="mt-0.5 text-sm text-indigo-800">
        타이어 바코드를 찍으세요. 같은 상품을 또 찍으면 수량이 늘어납니다.
      </p>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const el = (e.currentTarget.elements.namedItem("code") as HTMLInputElement) ?? null;
          if (el?.value.trim()) {
            handle(el.value.trim());
            el.value = "";
          }
        }}
      >
        <input
          name="code"
          placeholder="바코드"
          autoComplete="off"
          className="tabular min-w-0 flex-1 rounded-lg border-2 border-indigo-300 bg-white px-3 py-3 text-lg outline-none focus:border-indigo-700"
        />
        <button type="submit" className="rounded-lg bg-indigo-700 px-5 font-semibold text-white">
          추가
        </button>
      </form>

      {unknown && (
        <UnknownForManual
          code={unknown}
          onDone={() => {
            setUnknown(null);
            router.refresh();
          }}
          onCancel={() => setUnknown(null)}
        />
      )}

      {log.length > 0 && (
        <ul className="mt-3 space-y-1">
          {log.map((l) => (
            <li
              key={l.at}
              className={`tabular rounded px-2 py-1 text-sm ${
                l.ok ? "bg-white text-indigo-900" : "bg-red-50 text-red-700"
              }`}
            >
              {l.text}
            </li>
          ))}
        </ul>
      )}

      {/* 담긴 목록 — 수량과 매입가를 여기서 정한다 */}
      {inv.lines.length > 0 && (
        <ul className="mt-3 space-y-2">
          {inv.lines.map((l) => (
            <ManualRow key={l.itemId} line={l} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-indigo-700">
        매입가는 나중에 넣어도 됩니다. 비워 두면 원가·마진만 안 나옵니다.
        아래 「입고 예정」에서 <strong>전량 입고</strong>를 누르면 재고가 됩니다.
      </p>
      {pending && <p className="mt-1 text-sm text-indigo-700">처리 중…</p>}
    </section>
  );
}

function ManualRow({ line }: { line: PendingInvoice["lines"][number] }) {
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
      </div>
      {pending && <span className="text-xs text-slate-400">저장 중…</span>}
    </li>
  );
}

/** 직접 매입 중 처음 보는 바코드 — 검색해서 이어 준다 */
function UnknownForManual({
  code,
  onDone,
  onCancel,
}: {
  code: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ productId: number; model: string; spec: string | null }[]>([]);
  const [asPrefix, setAsPrefix] = useState(/^\d{6}[0-9A-Z]{6,}$/.test(code));
  const [error, setError] = useState<string | null>(null);

  const search = () =>
    start(async () => {
      const { searchProducts } = await import("@/lib/search-actions");
      const r = await searchProducts(q, { includeHidden: true });
      setHits(r.slice(0, 8).map((p) => ({ productId: p.productId, model: p.model, spec: p.spec })));
    });

  return (
    <div className="mt-3 rounded-xl border-2 border-amber-500 bg-amber-50 p-3">
      <p className="font-semibold text-amber-900">처음 보는 바코드입니다</p>
      <p className="tabular mt-0.5 text-sm text-amber-800">{code}</p>
      <p className="mt-1 text-xs text-amber-700">
        상품을 찾아 이어 주세요. <strong>다음부터는 자동으로 인식합니다.</strong>
      </p>

      {/^\d{6}[0-9A-Z]{6,}$/.test(code) && (
        <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={asPrefix}
            onChange={(e) => setAsPrefix(e.target.checked)}
            className="h-4 w-4"
          />
          앞 6자리(<strong className="tabular">{code.slice(0, 6)}</strong>)만 같고 뒤는 본마다 다름
        </label>
      )}

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="규격·모델명으로 찾기  예: 2255517 kinergy"
          className="min-w-0 flex-1 rounded-lg border border-amber-300 px-3 py-2"
        />
        <button type="submit" className="rounded-lg bg-amber-600 px-4 font-medium text-white">
          찾기
        </button>
      </form>

      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}

      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {hits.map((h) => (
          <li key={h.productId}>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await linkBarcode({
                    code: asPrefix ? code.slice(0, 6) : code,
                    productId: h.productId,
                    kind: asPrefix ? "prefix" : "exact",
                  });
                  if (!r.ok) setError(r.error);
                  else onDone();
                })
              }
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left active:bg-amber-100"
            >
              <div className="truncate text-sm font-medium">{h.model}</div>
              <div className="tabular text-xs text-slate-500">{h.spec}</div>
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={onCancel} className="mt-2 w-full py-2 text-sm text-amber-700">
        나중에
      </button>
    </div>
  );
}
