"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { linkBarcode } from "@/lib/barcode-lookup";
import { useScanner } from "../use-scanner";
import {
  createProductFromInvoiceItem,
  previewInvoice,
  receiveAll,
  receiveByScan,
  receiveLine,
  removeInvoice,
  removeInvoiceItem,
  saveInvoice,
  type InvoicePreview,
  type PendingInvoice,
  type PendingLine,
  type PreviewResult,
} from "@/lib/invoice";

const won = (n: number) => n.toLocaleString();

/**
 * ① 인보이스 업로드
 * ⚠️ 바로 저장하지 않는다. 인보이스는 돈이라 잘못 읽으면 매입원가가 통째로 틀어진다.
 *    검산 결과를 보여주고 사람이 확인한 뒤 저장한다.
 */
export function InvoiceUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pv, setPv] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [updatePrices, setUpdatePrices] = useState(true);
  /** ⭐ 여러 브랜드 파일을 한 번에 올린다 — 발주 후 3개를 끌어다 놓으면 끝난다 */
  const filesRef = useRef<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);

  function onPick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    filesRef.current = files;
    setNames(files.map((f) => f.name));
    setError(null);
    setMsg(null);
    setPv(null);

    start(async () => {
      const all: InvoicePreview[] = [];
      const problems: string[] = [];
      for (const f of files) {
        const r = await previewInvoice(f.name, await f.arrayBuffer());
        if ("error" in r) problems.push(`${f.name}: ${r.error}`);
        else all.push(...r.invoices);
      }
      if (problems.length) setError(problems.join("\n"));
      if (all.length > 0) {
        const dup = all.filter((i) => i.duplicate).length;
        setPv({
          invoices: all,
          note:
            `파일 ${files.length}개에서 인보이스 ${all.length}건을 읽었습니다` +
            (dup ? ` (이미 등록된 것 ${dup}건)` : ""),
        });
      }
    });
  }

  function commit() {
    const files = filesRef.current;
    if (files.length === 0) return;
    start(async () => {
      let saved = 0;
      let skipped = 0;
      let priceUpdates = 0;
      const problems: string[] = [];
      for (const f of files) {
        const r = await saveInvoice(f.name, await f.arrayBuffer(), { updatePrices });
        if (!r.ok) problems.push(`${f.name}: ${r.error}`);
        else {
          saved += r.saved;
          skipped += r.skipped;
          priceUpdates += r.priceUpdates;
        }
      }
      setError(problems.length ? problems.join("\n") : null);
      if (saved > 0) {
        setMsg(
          `인보이스 ${saved}건 등록했습니다.` +
            (skipped ? ` (이미 있던 ${skipped}건은 건너뜀)` : "") +
            (priceUpdates ? ` 매입 할인율 ${priceUpdates}건 갱신.` : ""),
        );
        setPv(null);
        filesRef.current = [];
        setNames([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <section className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-4">
      <h2 className="font-bold">인보이스 올리기</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        <strong>미쉐린 · 콘티넨탈 · 금호</strong> 엑셀을 한 번에 여러 개 올릴 수 있습니다.
        이미 올린 건은 알아서 건너뜁니다.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.pdf"
        onChange={(e) => onPick(e.target.files)}
        className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm
                   file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:py-2
                   file:text-sm file:font-semibold file:text-white"
      />
      {names.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{names.join(" · ")}</p>
      )}
      <p className="mt-1 text-xs text-slate-400">
        엑셀을 권합니다 — PDF 는 양식이 조금만 바뀌어도 못 읽습니다.
      </p>

      {pending && <p className="mt-3 text-sm text-slate-500">읽는 중…</p>}
      {error && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>
      )}
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800">{msg}</p>}

      {pv && (
        <div className="mt-4">
          {pv.note && (
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{pv.note}</p>
          )}

          <ul className="space-y-3">
            {pv.invoices.map((one) => (
              <InvoiceCard key={one.invoiceNo} one={one} />
            ))}
          </ul>

          <label className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <input
              type="checkbox"
              checked={updatePrices}
              onChange={(e) => setUpdatePrices(e.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span>
              <strong>매입 할인율·기표가를 함께 갱신</strong>
              <span className="block text-xs text-slate-500">
                인보이스는 실제로 돈이 오간 근거라 가장 정확합니다. 마진이 정확해집니다.
              </span>
            </span>
          </label>

          <button
            type="button"
            disabled={pending || pv.invoices.every((i) => i.duplicate)}
            onClick={commit}
            className="mt-3 w-full rounded-xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {pending
              ? "저장 중…"
              : `입고 예정으로 등록 (${pv.invoices.filter((i) => !i.duplicate).length}건)`}
          </button>
        </div>
      )}
    </section>
  );
}

/** 인보이스 한 건 미리보기 */
function InvoiceCard({ one }: { one: InvoicePreview }) {
  const missing = one.matches.filter((m) => !m.productId).length;
  return (
    <li
      className={`rounded-xl border p-3 ${
        one.duplicate ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-300 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold">
          {one.supplier} <span className="tabular text-sm font-normal text-slate-500">{one.invoiceNo}</span>
        </span>
        <span className="tabular text-sm text-slate-500">
          {one.issuedAt} · {one.totalQty}본 · {one.total ? won(one.total) : "—"}원
        </span>
      </div>

      {one.duplicate ? (
        <p className="mt-1 text-sm text-slate-500">이미 등록돼 있습니다 — 건너뜁니다</p>
      ) : (
        <p
          className={`mt-1 rounded px-2 py-1 text-xs ${
            one.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
          }`}
        >
          {one.checks.length === 0 ? "✅ 금액 검산이 맞습니다" : one.checks.join(" / ")}
        </p>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {one.items.map((it, i) => {
          const m = one.matches[i];
          return (
            <li key={it.cai + i} className="py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m?.model ?? it.description}</div>
                  <div className="tabular text-xs text-slate-500">
                    {it.cai} · {it.qty}본
                    {it.discountRate > 0 && ` · 할인 ${(it.discountRate * 100).toFixed(0)}%`}
                  </div>
                </div>
                <div className="tabular shrink-0 text-right">
                  <div className="text-sm font-bold">{won(it.unitCost)}원</div>
                  <div className="text-xs text-slate-400">{won(it.supplyAmount)}</div>
                </div>
              </div>
              {!m?.productId && (
                <p className="text-xs text-red-600">상품 미등록 — 먼저 등록해야 입고됩니다</p>
              )}
              {m?.priceDiffers && (
                <p className="text-xs text-amber-700">
                  기표가 {won(m.ourListPrice!)} → {won(it.unitListPrice)} 로 갱신됩니다
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {missing > 0 && (
        <p className="mt-1 text-xs text-red-600">상품 미등록 {missing}건</p>
      )}
    </li>
  );
}

/**
 * ⭐ 바코드 스캔 입고 (2026-08-01)
 *
 * 리더기는 키보드처럼 동작한다. **커서를 어디 두든** 찍으면 잡힌다 —
 * 장갑 낀 손으로 입력칸을 먼저 눌러야 한다면 아무도 안 쓴다 (D-11 4번).
 *
 * 찍을 때마다 대기 수량이 1씩 줄어든다. **찍는 행위가 곧 검수다.**
 */
export function ScanBox({ lines }: { lines: PendingLine[] }) {
  const router = useRouter();
  const [log, setLog] = useState<{ ok: boolean; text: string; at: number }[]>([]);
  const [busy, setBusy] = useState(false);
  /** 못 알아본 바코드 — 사장님이 이어 주면 다음부터 자동이 된다 */
  const [unknown, setUnknown] = useState<string | null>(null);

  const handle = (code: string) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      const r = await receiveByScan(code);
      const text = r.ok
        ? `✅ ${r.line.model ?? r.line.cai} 1본 — 남은 ${r.remain}본`
        : `❌ ${r.error}`;
      setLog((l) => [{ ok: r.ok, text, at: Date.now() }, ...l].slice(0, 6));
      setUnknown(!r.ok && r.unknown ? (r.code ?? code) : null);
      setBusy(false);
      if (r.ok) router.refresh();
    })();
  };

  useScanner(handle, !unknown);

  return (
    <section className="mt-5 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-4">
      <h2 className="font-bold text-emerald-900">바코드로 입고</h2>
      <p className="mt-0.5 text-sm text-emerald-800">
        타이어 <strong>라벨지 바코드</strong>를 찍으면 1본씩 입고됩니다. 화면 아무 데나 두고 찍으세요.
      </p>

      {/* 리더기가 없을 때·폰에서 쓸 수 있게 직접 입력도 열어 둔다 */}
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
          placeholder="441358261D590A"
          autoComplete="off"
          className="tabular min-w-0 flex-1 rounded-lg border-2 border-emerald-300 bg-white px-3 py-3 text-lg outline-none focus:border-emerald-700"
        />
        <button type="submit" className="rounded-lg bg-emerald-700 px-5 font-semibold text-white">
          입고
        </button>
      </form>

      {/* ⭐ 못 알아본 바코드를 여기서 이어 준다. 한 번만 하면 다음부터 자동 */}
      {unknown && (
        <LinkBarcode
          code={unknown}
          lines={lines}
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
                l.ok ? "bg-white text-emerald-900" : "bg-red-50 text-red-700"
              }`}
            >
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 처음 보는 바코드를 상품과 잇는다.
 *
 * 브랜드마다 체계가 달라 미리 다 알 수 없다 —
 * 한국타이어는 EAN-13(8808563590301), 미쉐린은 품번+개별번호(441358261D590A).
 * 그래서 **한 번 이어 주면 그다음부터 자동**이 되게 한다 (D-05 와 같은 철학).
 */
function LinkBarcode({
  code,
  lines,
  onDone,
  onCancel,
}: {
  code: string;
  lines: PendingLine[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** 앞부분만 같고 뒤가 본마다 다른 형태인가 (미쉐린식) */
  const [asPrefix, setAsPrefix] = useState(/^\d{6}[0-9A-Z]{6,}$/.test(code));
  const prefix = code.slice(0, 6);

  const link = (productId: number) =>
    start(async () => {
      setError(null);
      const r = await linkBarcode({
        code: asPrefix ? prefix : code,
        productId,
        kind: asPrefix ? "prefix" : "exact",
      });
      if (!r.ok) setError(r.error);
      else onDone();
    });

  const candidates = lines.filter((l) => l.productId);

  return (
    <div className="mt-3 rounded-xl border-2 border-amber-500 bg-amber-50 p-3">
      <p className="font-semibold text-amber-900">처음 보는 바코드입니다</p>
      <p className="tabular mt-0.5 text-sm text-amber-800">{code}</p>
      <p className="mt-1 text-xs text-amber-700">
        어느 상품인지 골라 주세요. <strong>다음부터는 자동으로 인식합니다.</strong>
      </p>

      {/^\d{6}[0-9A-Z]{6,}$/.test(code) && (
        <label className="mt-2 flex items-start gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={asPrefix}
            onChange={(e) => setAsPrefix(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            앞 6자리(<strong className="tabular">{prefix}</strong>)만 같고 뒤는 본마다 다름
            <span className="block text-amber-700">
              미쉐린처럼 개별번호가 붙는 형태입니다. 끄면 이 바코드 하나만 등록합니다.
            </span>
          </span>
        </label>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {candidates.length === 0 && (
          <li className="text-sm text-amber-800">입고 예정 목록이 비어 있습니다. 인보이스를 먼저 올려 주세요.</li>
        )}
        {candidates.map((l) => (
          <li key={l.itemId}>
            <button
              type="button"
              disabled={pending}
              onClick={() => link(l.productId!)}
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left active:bg-amber-100 disabled:opacity-50"
            >
              <div className="truncate text-sm font-medium">{l.model ?? l.description}</div>
              <div className="tabular text-xs text-slate-500">
                {[l.spec, l.cai].filter(Boolean).join(" · ")} · {l.qty - l.receivedQty}본 대기
              </div>
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

/** ② 도착 확정 — 인보이스 단위로 묶어서 다룬다 */
export function PendingList({ invoices }: { invoices: PendingInvoice[] }) {
  return (
    <>
      <ScanBox lines={invoices.flatMap((i) => i.lines)} />
      <ul className="mt-4 space-y-4">
        {invoices.map((inv) => (
          <PendingInvoiceCard key={inv.invoiceId} inv={inv} />
        ))}
      </ul>
    </>
  );
}

function PendingInvoiceCard({ inv }: { inv: PendingInvoice }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className="rounded-xl border-2 border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-bold">
          {inv.supplier}{" "}
          <span className="tabular text-sm font-normal text-slate-500">{inv.invoiceNo}</span>
        </span>
        <span className="tabular text-sm text-slate-500">
          {inv.issuedAt} · <strong className="text-amber-800">{inv.remain}본 대기</strong>
        </span>
      </div>

      {error && <p className="mt-2 whitespace-pre-line text-sm text-red-600">{error}</p>}

      {/* ⭐ 바코드 없이 한 번에 재고로 (사장님 요청) */}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await receiveAll(inv.invoiceId);
              if (!r.ok) setError(r.error);
              else {
                if (r.failed.length) setError(`${r.created}본 입고. 남은 문제:\n${r.failed.join("\n")}`);
                router.refresh();
              }
            })
          }
          className="flex-1 rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : `전량 입고 (${inv.remain}본)`}
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await removeInvoice(inv.invoiceId);
                  if (!r.ok) setError(r.error ?? "지우지 못했습니다");
                  else router.refresh();
                })
              }
              className="rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white"
            >
              정말 삭제
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-2 text-sm text-slate-500"
            >
              취소
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="인보이스 삭제"
            className="rounded-lg border border-slate-300 px-4 py-3 text-slate-400"
          >
            ✕
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        전량 입고는 DOT 없이 들어갑니다. DOT 를 넣으려면 아래에서 품목별로 하세요.
      </p>

      <ul className="mt-2 space-y-2">
        {inv.lines.map((l) => (
          <PendingRow key={l.itemId} l={l} />
        ))}
      </ul>
    </li>
  );
}

function PendingRow({ l }: { l: PendingLine }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const remain = l.qty - l.receivedQty;
  const [qty, setQty] = useState(remain);
  const [dot, setDot] = useState("");
  const [error, setError] = useState<string | null>(null);

  const BTN = "h-11 w-11 shrink-0 rounded-lg border border-slate-300 bg-white text-xl font-bold";

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{l.model ?? l.description}</div>
          <div className="tabular text-xs text-slate-500">
            {[l.spec, l.cai].filter(Boolean).join(" · ")}
            {l.unitCost ? ` · 본당 ${won(l.unitCost)}원` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="tabular rounded-lg bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-900">
            {remain}본
          </span>
          {/* ⭐ 타이어가 아닌 것이 섞여 온다 — 목록에서 뺀다 (사장님 요청) */}
          <button
            type="button"
            disabled={pending}
            aria-label="이 품목 빼기"
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await removeInvoiceItem(l.itemId);
                if (!r.ok) setError(r.error ?? "지우지 못했습니다");
                else router.refresh();
              })
            }
            className="px-2 text-slate-300 active:text-red-600"
          >
            ✕
          </button>
        </div>
      </div>

      {!l.productId ? (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">상품 목록에 없어 입고할 수 없습니다</p>
          <p className="tabular mt-0.5 text-xs text-red-600">{l.description}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* ⭐ 인보이스에 규격·모델명·기표가가 다 있다. 그대로 만든다 */}
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await createProductFromInvoiceItem(l.itemId);
                  if (!r.ok) setError(r.error);
                  else router.refresh();
                })
              }
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "만드는 중…" : "인보이스 정보로 상품 만들기"}
            </button>
            <Link
              href={`/product/new?q=${encodeURIComponent(l.cai)}`}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600"
            >
              직접 등록
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-xs text-slate-500">DOT</span>
              <input
                value={dot}
                onChange={(e) => setDot(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="모르면 비움"
                inputMode="numeric"
                className="tabular h-11 w-28 rounded-lg border border-slate-300 px-2 text-lg"
              />
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" className={BTN} onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <input
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(remain, Number(e.target.value.replace(/\D/g, "")) || 1)))}
                inputMode="numeric"
                className="tabular h-11 w-14 rounded-lg border border-slate-300 text-center text-lg font-bold"
              />
              <span className="w-4 text-sm text-slate-500">본</span>
              <button type="button" className={BTN} onClick={() => setQty((q) => Math.min(remain, q + 1))}>
                +
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await receiveLine({ itemId: l.itemId, qty, dot: dot || null });
                if (!r.ok) setError(r.error);
                else router.refresh();
              })
            }
            className="mt-2 w-full rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50"
          >
            {pending ? "처리 중…" : `${qty}본 입고 확정`}
          </button>
        </>
      )}
    </li>
  );
}
