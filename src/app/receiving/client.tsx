"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { ProductPicker } from "./product-picker";
import {
  createProductFromInvoiceItem,
  linkCandidates,
  linkInvoiceItemTo,
  previewInvoice,
  receiveAll,
  receiveLine,
  removeInvoice,
  removeInvoiceItem,
  resumeManualPurchase,
  saveInvoice,
  type InvoicePreview,
  type LinkCandidate,
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
  // 타이어가 아닌 줄은 「미등록」으로 세지 않는다 — 등록할 것이 아니다
  const missing = one.matches.filter((m) => !m.productId && m.kind !== "notTire").length;
  const notTire = one.matches.filter((m) => m.kind === "notTire").length;
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
                  {/*
                    ⭐ 품번이 안 맞아 규격+모델로 찾은 것은 알려 준다 (2026-08-03).
                       거의 맞지만 **다른 상품일 수도** 있어 사장님 눈이 한 번 필요하다.
                  */}
                  {m?.matchedBy === "규격+모델" && (
                    <p className="text-xs text-sky-700">
                      품번이 달라 규격·모델로 찾았습니다 — 맞는지 봐 주세요
                      <span className="block truncate text-slate-400">{it.description}</span>
                    </p>
                  )}
                </div>
                <div className="tabular shrink-0 text-right">
                  <div className="text-sm font-bold">{won(it.unitCost)}원</div>
                  <div className="text-xs text-slate-400">{won(it.supplyAmount)}</div>
                </div>
              </div>
              {/*
                ⭐ 「상품 미등록」과 「타이어가 아님」을 구분한다 (사장님 확인 2026-08-03).
                   미쉐린 인보이스의 `TYREPLUS FRANCHISE EXPRESS` 같은 수수료 줄이
                   빨갛게 떠서, 등록하려다 규격 오류만 보게 됐다.
              */}
              {m?.kind === "notTire" ? (
                <p className="text-xs text-slate-500">타이어가 아닙니다 — 입고에서 넘어갑니다</p>
              ) : m?.kind === "unreadable" && !m?.productId ? (
                <p className="text-xs text-amber-700">규격을 읽지 못했습니다 — 확인해 주세요</p>
              ) : !m?.productId ? (
                <p className="text-xs text-red-600">상품 미등록 — 먼저 등록해야 입고됩니다</p>
              ) : null}
              {m?.priceDiffers && (
                <p className="text-xs text-amber-700">
                  기표가 {won(m.ourListPrice!)} → {won(it.unitListPrice)} 로 갱신됩니다
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {missing > 0 && <p className="mt-1 text-xs text-red-600">상품 미등록 {missing}건</p>}
      {notTire > 0 && <p className="mt-1 text-xs text-slate-500">타이어가 아닌 줄 {notTire}건 (수수료 등)</p>}
    </li>
  );
}
/**
 * ② 도착 확정 — 인보이스 단위로 묶어서 다룬다.
 *
 * 🔴 **바코드 스캔 입고를 걷어냈다** (사장님 지시 2026-08-04 — "써보니 생각보다 불편하다").
 *    D-11 4번("바코드는 전역 키 감지, 커서 위치 무관")은 이것으로 폐기된다.
 *    실사용 결과가 근거다 — 배운 바코드 1건 · 스캔으로 만든 입출고 0건.
 *    확정은 원래부터 줄마다 수량·DOT 를 넣거나 「전량 입고」로 됐다.
 */
export function PendingList({ invoices, draftId }: { invoices: PendingInvoice[]; draftId?: number }) {
  return (
    <ul className="mt-4 space-y-4">
      {invoices.map((inv) => (
        <PendingInvoiceCard key={inv.invoiceId} inv={inv} mine={inv.invoiceId === draftId} />
      ))}
    </ul>
  );
}

function PendingInvoiceCard({ inv, mine }: { inv: PendingInvoice; mine?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const isManual = inv.invoiceNo.startsWith("직접-");

  return (
    <li className="rounded-xl border-2 border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-bold">
          {inv.supplier}{" "}
          <span className="tabular text-sm font-normal text-slate-500">{inv.invoiceNo}</span>
          {isManual && mine && (
            <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800">
              담는 중
            </span>
          )}
        </span>
        <span className="tabular text-sm text-slate-500">
          {inv.issuedAt} · <strong className="text-amber-800">{inv.remain}본 대기</strong>
        </span>
      </div>

      {/*
        ⭐ 직접 장부는 기기마다 따로 담는다 (사장님 지적 2026-08-06).
           다른 기기(사람)가 담던 장부는 여기서 「이어서 담기」로 넘겨받는다.
      */}
      {isManual && !mine && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await resumeManualPurchase(inv.invoiceId);
              if (!r.ok) setError(r.error);
              else router.refresh();
            })
          }
          className="mt-2 w-full rounded-lg border border-indigo-300 bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-800 active:bg-indigo-100"
        >
          이어서 담기 — 이 장부를 위 담기 화면으로 가져옵니다
        </button>
      )}

      {error && <p className="mt-2 whitespace-pre-line text-sm text-red-600">{error}</p>}

      {/* ⭐ 바코드 없이 한 번에 재고로 (사장님 요청) */}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending || inv.remain === 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await receiveAll(inv.invoiceId);
              if (!r.ok) setError(r.error);
              else {
                const notes = [
                  r.failed.length ? `남은 문제:\n${r.failed.join("\n")}` : null,
                  // 수수료 줄은 문제가 아니다 — 넘어갔다고만 알린다
                  r.skipped > 0 ? `타이어가 아닌 줄 ${r.skipped}건은 넘어갔습니다` : null,
                ].filter(Boolean);
                if (notes.length) setError(`${r.created}본 입고. ${notes.join("\n")}`);
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

      {/*
        ⭐ 인보이스에 없던 물건이 같이 온 경우 (사장님 요청 2026-08-03).
           찾아서 이 장부에 담으면 매입 내역이 한 곳에서 이어진다.
           평소에는 접어 둔다 — 대부분은 인보이스 그대로 들어온다.
      */}
      {addOpen ? (
        <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-slate-700">품목 찾아서 담기</span>
            <button type="button" onClick={() => setAddOpen(false)} className="text-sm text-slate-500">
              닫기
            </button>
          </div>
          <ProductPicker invoiceId={inv.invoiceId} tone="slate" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          + 인보이스에 없는 품목 담기
        </button>
      )}

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

          {/*
            ⭐ 품목 정리 ③ (사장님 승인 2026-08-05) — 만들기 전에 **이을 수 있는
               기존 상품**을 먼저 보여준다. 중복의 뿌리가 「만들기부터 누르는 것」이었다.
               한 번 이으면 거래처 사전에 남아 다음부터는 저절로 붙는다.
          */}
          <LinkFirst itemId={l.itemId} onDone={() => router.refresh()} />

          <div className="mt-2 flex flex-wrap gap-2">
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
              className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {pending ? "만드는 중…" : "새 상품으로 만들기 (이을 것이 없을 때)"}
            </button>
            <Link
              href={`/settings/products?tab=new&q=${encodeURIComponent(l.cai)}`}
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

/**
 * ⭐ 품목 정리 ③ — 미연결 인보이스 줄에 「이 상품에 연결」 후보를 내민다 (2026-08-05).
 *    같은 브랜드·규격의 기존 상품을 보여주고, 고르면 잇고 거래처 사전에도 남긴다.
 *    취급(사고판 적 있는 것)이 위에 온다 — 그게 맞을 확률이 높다.
 */
function LinkFirst({ itemId, onDone }: { itemId: number; onDone: () => void }) {
  const [cands, setCands] = useState<LinkCandidate[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void linkCandidates(itemId).then((r) => {
      if (alive) setCands(r);
    });
    return () => {
      alive = false;
    };
  }, [itemId]);

  if (cands === null || cands.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2">
      <p className="text-xs font-semibold text-emerald-900">
        같은 규격의 기존 상품이 있습니다 — 새로 만들기 전에 확인하세요
      </p>
      <ul className="mt-1.5 space-y-1">
        {cands.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {c.name}
                {c.used && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[11px] text-emerald-800">취급</span>}
              </div>
              <div className="tabular text-xs text-slate-500">
                {[c.marsItemNo, c.loadSpeed, c.stockQty > 0 ? `재고 ${c.stockQty}본` : null,
                  c.listPrice !== null ? `기표가 ${c.listPrice.toLocaleString()}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await linkInvoiceItemTo(itemId, c.id);
                  if (!r.ok) setError(r.error);
                  else onDone();
                })
              }
              className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              이 상품에 연결
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
      <p className="mt-1.5 text-[11px] text-emerald-800">한 번 이으면 다음 인보이스부터는 저절로 붙습니다.</p>
    </div>
  );
}
