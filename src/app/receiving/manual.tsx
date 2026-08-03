"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkBarcode } from "@/lib/barcode-lookup";
import {
  addScannedToPurchase,
  removeInvoice,
  startManualPurchase,
  updatePurchaseItem,
  type PendingInvoice,
} from "@/lib/invoice";
import { ScanIndicator } from "../scan-indicator";
import { useScanner } from "../use-scanner";
import { ProductPicker } from "./product-picker";
import { SupplierInput } from "./supplier-input";

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
  /**
   * 🔴 담는 방법을 **장부를 열기 전에** 고르게 한다 (2026-08-03).
   *    처음엔 장부 안에만 탭을 넣었는데, 열려 있는 장부가 없으면 「거래처 + 시작」
   *    폼만 보여서 품목 검색이 있다는 것 자체를 알 수 없었다.
   *    사장님이 "적용이 안 됐는데?" 하신 것이 이것이다.
   */
  const [startMode, setStartMode] = useState<"scan" | "search">("scan");

  function begin(mode: "scan" | "search") {
    setStartMode(mode);
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

          {/* 담는 방법을 여기서 고른다 — 바코드가 안 찍히는 물건이 흔하다 */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!ready}
              onClick={() => begin("scan")}
              className="rounded-xl bg-slate-900 py-3.5 font-semibold text-white active:bg-slate-700 disabled:opacity-40"
            >
              바코드로 담기
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => begin("search")}
              className="rounded-xl border-2 border-slate-900 py-3.5 font-semibold text-slate-900 active:bg-slate-100 disabled:opacity-40"
            >
              품목 검색으로 담기
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            거래처를 먼저 적어 주세요. 담는 방법은 나중에 바꿔도 됩니다.
          </p>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    );
  }

  return <ManualScanning inv={open} initialMode={startMode} />;
}

function ManualScanning({
  inv,
  initialMode = "scan",
}: {
  inv: PendingInvoice;
  initialMode?: "scan" | "search";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [log, setLog] = useState<{ ok: boolean; text: string; at: number }[]>([]);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * ⭐ 담는 방법이 둘이다 (사장님 요청 2026-08-03) — 바코드 · 품목 검색.
   *    라벨이 떨어졌거나 거래처가 아예 안 붙여 보내는 경우가 흔하다.
   *    🔴 탭을 나눈 이유: 스캐너는 키보드로 들어온다. 검색창에 초점이 있으면
   *       바코드가 검색어로 들어가 버린다. 「품목 검색」일 때는 스캐너를 끈다.
   */
  const [mode, setMode] = useState<"scan" | "search">(initialMode);

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

  // 「품목 검색」일 때는 스캐너를 끈다 — 안 그러면 바코드가 검색어 칸에 박힌다
  useScanner(handle, mode === "scan" && !unknown);

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
      {/* 담는 방법 고르기 — 바코드가 안 찍히는 물건이 흔하다 */}
      <div className="mt-3 flex gap-1 rounded-xl bg-white/70 p-1">
        {(
          [
            ["scan", "바코드"],
            ["search", "품목 검색"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${
              mode === m ? "bg-indigo-700 text-white" : "text-indigo-800 active:bg-indigo-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "scan" ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ScanIndicator active={!unknown} busy={busy} tone="indigo" />
            <span className="text-sm text-indigo-800">
              {unknown ? "바코드를 이어 주면 다시 시작합니다" : "찍으면 수량이 1씩 늘어납니다"}
            </span>
          </div>

          <form
            className="mt-2 flex gap-2"
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
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-indigo-800">
            바코드가 없거나 안 찍힐 때. <strong>여러 품목을 이어서 담을 수 있습니다.</strong>
          </p>
          <ProductPicker invoiceId={inv.invoiceId} tone="indigo" />
        </>
      )}

      {mode === "scan" && log.length > 0 && (
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
