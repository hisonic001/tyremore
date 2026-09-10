"use client";

/**
 * ⭐ 거래처×달 정산 화면 (사장님 요청 2026-09-01)
 *
 *   판정은 건마다 저장되고(멱등 — 고치면 적용 자국이 풀린다), 「한꺼번에 적용」이
 *   실제로 판매를 고친다. 미리보기 강제 리듬은 receiving/paste.tsx 그대로.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addNewSales,
  applySettlement,
  approveRest,
  deleteRun,
  markDeposited,
  reopenRun,
  saveDecision,
  linkSettleTax,
  saveMatchedDecisions,
  startSettlement,
  type ApplyLineResult,
} from "@/lib/settlement";
import { previewReply, type ReplyPreview } from "@/lib/settlement-paste";
import type { SettleLineView, SettleView } from "@/lib/settlement-data";
import type { SettleTaxHint } from "@/lib/settle-tax";
import { useConfirm } from "@/components/ui/confirm";
import { SPLITTABLE } from "@/lib/payments";

const won = (n: number) => n.toLocaleString("ko-KR");

const DECISION_TONE: Record<string, string> = {
  대기: "bg-slate-100 text-slate-500",
  승인: "bg-emerald-100 text-emerald-800",
  조정: "bg-sky-100 text-sky-800",
  부분반려: "bg-orange-100 text-orange-800",
  반려: "bg-red-100 text-red-700",
  보류: "bg-slate-200 text-slate-600",
};

export function SettleClient({
  view,
  autoAdded = 0,
  taxHints = [],
}: {
  view: SettleView;
  /** 이 화면을 여는 순간 자동으로 담긴 건 수 (2026-09-10 「항상 최신으로」) */
  autoAdded?: number;
  /** 이 청구와 짝일 만한 매출계산서 후보 */
  taxHints?: SettleTaxHint[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const [results, setResults] = useState<ApplyLineResult[] | null>(null);

  const { run, supplier, ym, lines } = view;

  /* ── 회차가 아직 없다 — 그 달 미리보기와 시작 버튼 ── */
  if (!run) {
    return (
      <div>
        <h1 className="mt-3 text-xl font-bold">
          {supplier} <span className="tabular text-base font-medium text-slate-500">{ym}</span>
        </h1>
        <p className="tabular mt-2 text-sm text-slate-600">
          그 달 외상 판매 <strong>{view.monthCount}건 · {won(view.monthTotal)}원</strong>
        </p>
        {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <button
          type="button"
          disabled={pending || view.monthCount === 0}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await startSettlement(supplier, ym);
              if (!r.ok) return setErr(r.error);
              router.refresh();
            })
          }
          className="mt-4 w-full rounded-control bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {view.monthCount === 0 ? "그 달 외상 판매가 없습니다" : pending ? "여는 중…" : `정산 시작 — ${view.monthCount}건 담기`}
        </button>
      </div>
    );
  }

  const undecided = lines.filter((l) => l.decision === "대기").length;
  const decided = lines.filter((l) => !["대기", "보류"].includes(l.decision));
  const toApply = decided.filter((l) => !l.applied);
  const billedSum = lines.reduce((s, l) => s + l.billed, 0);
  const agreedSum = lines.reduce((s, l) => s + (l.agreed ?? l.billed), 0);
  const remainSum = lines.reduce(
    (s, l) => s + (l.currentStatus === "성사" ? Math.max(0, l.currentTotal - l.paid) : 0),
    0,
  );
  const locked = run.status === "입금완료";

  const doApply = async () => {
    const cut = billedSum - agreedSum;
    const ok = await ask({
      title: "판정대로 한꺼번에 적용할까요?",
      body:
        `판정 ${toApply.length}건을 실제 판매에 반영합니다.\n` +
        `청구 ${won(billedSum)}원 → 합의 ${won(agreedSum)}원${cut !== 0 ? ` (${cut > 0 ? "−" : "+"}${won(Math.abs(cut))}원)` : ""}\n` +
        "조정은 판매 금액을 합의가로 고치고, 반려는 판매를 취소합니다. 원래 청구액은 정산 기록에 남습니다.",
      confirmLabel: "적용",
    });
    if (!ok) return;
    start(async () => {
      setErr(null);
      setResults(null);
      const r = await applySettlement(run.id);
      if (!r.ok) return setErr(r.error);
      setResults(r.results);
      router.refresh();
    });
  };

  return (
    <div>
      {confirmDialog}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h1 className="min-w-0 truncate text-xl font-bold">
          {supplier} <span className="tabular text-base font-medium text-slate-500">{ym}</span>
        </h1>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${DECISION_TONE[run.status === "입금완료" ? "승인" : "조정"] }`}>
          {run.status}
        </span>
      </div>
      <p className="tabular mt-1 text-sm text-slate-600">
        {lines.length}건 · 청구 <strong>{won(billedSum)}원</strong>
        {agreedSum !== billedSum && (
          <>
            {" "}→ 합의 <strong className="text-sky-800">{won(agreedSum)}원</strong>
          </>
        )}
        {remainSum > 0 && (
          <>
            {" "}· 미수 <strong className="text-amber-800">{won(remainSum)}원</strong>
          </>
        )}
      </p>

      {/* ⭐ 항상 최신으로 (2026-09-10) — 열 때 자동으로 담긴 것을 알린다 */}
      {autoAdded > 0 && (
        <p className="tabular mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          지난번 만든 뒤 등록된 <strong>{autoAdded}건</strong>을 방금 담아 최신으로 맞췄습니다 — 지금 청구액은{" "}
          <strong>{won(billedSum)}원</strong>입니다.
        </p>
      )}

      {/* ⭐ 이 청구의 계산서 짝 (2026-09-10) — 자동으로 잇지 않고 확인을 받는다 */}
      {taxHints.length > 0 && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
          <p className="text-sm font-semibold text-sky-900">이 청구의 계산서 짝</p>
          <ul className="mt-2 space-y-2">
            {taxHints.map((h) => (
              <li key={h.invoiceId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="tabular min-w-0 text-sm">
                  <strong>{h.counterparty}</strong> · {h.issueDate} · {won(h.total)}원
                  <span className="ml-1 text-xs text-slate-500">{h.summary}</span>
                  <span className="block text-xs text-sky-800">{h.why}</span>
                </span>
                {h.linked ? (
                  <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    이미 이어짐
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setErr(null);
                        const ok = await ask({
                          title: "이 계산서에 그 달 외상을 이을까요?",
                          body:
                            `${h.counterparty} ${h.issueDate} ${won(h.total)}원 계산서에 ` +
                            `${supplier} ${ym} 외상 ${lines.length}건을 잇습니다.
` +
                            "이으면 「계산서로 받은 돈」으로 인식돼 외상 화면에서 정리됩니다.",
                          confirmLabel: "잇기",
                        });
                        if (!ok) return;
                        const r = await linkSettleTax(supplier, ym, h.invoiceId);
                        if (!r.ok) return setErr(r.error);
                        router.refresh();
                      })
                    }
                    className="shrink-0 rounded-control border border-sky-400 bg-white px-3 py-1.5 text-sm font-medium text-sky-800 disabled:opacity-50"
                  >
                    이 계산서로 잇기
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 도구 줄: 청구서 · 새 판매 담기 · 다시 열기 ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/receivables/settle/export?supplier=${encodeURIComponent(supplier)}&ym=${ym}`}
          className="rounded-control border border-brand-300 bg-white px-3 py-2 text-sm font-medium text-brand-700"
        >
          📄 청구서 내려받기
        </a>
        {view.newSalesCount > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await addNewSales(run.id);
                if (!r.ok) return setErr(r.error);
                router.refresh();
              })
            }
            className="rounded-control border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800"
          >
            그 뒤 등록된 {view.newSalesCount}건 담기
          </button>
        )}
        {locked ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await reopenRun(run.id);
                if (!r.ok) return setErr(r.error);
                router.refresh();
              })
            }
            className="rounded-control px-3 py-2 text-sm text-slate-500 underline"
          >
            다시 열기
          </button>
        ) : (
          lines.every((l) => !l.applied) && (
            <button
              type="button"
              disabled={pending}
              onClick={async () => {
                const ok = await ask({
                  title: "이 회차를 지울까요?",
                  body: "판매에는 아무 변화가 없습니다 — 정산 담은 것만 지워집니다.",
                  confirmLabel: "지우기",
                });
                if (!ok) return;
                start(async () => {
                  const r = await deleteRun(run.id);
                  if (!r.ok) return setErr(r.error);
                  router.push("/receivables/settle");
                });
              }}
              className="rounded-control px-3 py-2 text-sm text-slate-400 underline"
            >
              회차 지우기
            </button>
          )
        )}
      </div>
      {run.invoicedAmount != null && (
        <p className="tabular mt-1 text-xs text-slate-500">
          청구서 스냅샷 {won(run.invoicedAmount)}원 (내보낸 때 {run.invoiceExportedAt})
        </p>
      )}

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {/* ── 회신 반영 ── */}
      {!locked && <ReplySection runId={run.id} onErr={setErr} />}

      {/* ── 적용 결과 ── */}
      {results && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="font-semibold text-violet-900">
            적용 결과 — 됨 {results.filter((r) => r.ok).length}건 · 안 됨 {results.filter((r) => !r.ok).length}건
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? "text-violet-800" : "font-medium text-red-700"}>
                {r.ok ? "✓" : "✗"} {r.quoteNo} {r.decision} — {r.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 건별 판정 ── */}
      <ul className="mt-4 space-y-2">
        {lines.map((l) => (
          <LineCard key={l.lineId} l={l} locked={locked} onErr={setErr} />
        ))}
      </ul>

      {/* ── 한꺼번에 적용 ── */}
      {!locked && (
        <div className="sticky bottom-20 mt-4 rounded-2xl border-2 border-brand-300 bg-white p-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            {undecided > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={async () => {
                  const ok = await ask({
                    title: `대기 ${undecided}건을 전부 승인할까요?`,
                    body: "회신에 없던 건은 보통 그대로 인정된 것입니다 — 청구액 그대로 합의로 표시합니다.",
                    confirmLabel: "전부 승인",
                  });
                  if (!ok) return;
                  start(async () => {
                    const r = await approveRest(run.id);
                    if (!r.ok) return setErr(r.error);
                    router.refresh();
                  });
                }}
                className="rounded-control border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800"
              >
                남은 대기 {undecided}건 전부 승인
              </button>
            )}
            <button
              type="button"
              disabled={pending || toApply.length === 0}
              onClick={doApply}
              className="min-w-0 flex-1 rounded-control bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pending ? "적용 중…" : `한꺼번에 적용 (${toApply.length}건)`}
            </button>
          </div>
        </div>
      )}

      {/* ── 입금 반영 ── */}
      {remainSum > 0 && <DepositSection runId={run.id} remain={remainSum} onErr={setErr} ask={ask} />}
      {locked && run.depositedAmount != null && (
        <p className="tabular mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          입금 {won(run.depositedAmount)}원 반영됨{run.depositedOn ? ` (${run.depositedOn})` : ""}
        </p>
      )}

      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        조정·반려를 저장해도 판매는 아직 안 바뀝니다 — <strong>「한꺼번에 적용」</strong>을 눌러야 실제로
        반영됩니다. 원래 청구액은 이 회차에 그대로 남고, 적용 뒤에도 판정을 고쳐 다시 적용할 수 있습니다.
      </p>
    </div>
  );
}

/* ============================================================
 * 건 하나 — 판정 버튼과 줄별 고치기
 * ========================================================== */
function LineCard({ l, locked, onErr }: { l: SettleLineView; locked: boolean; onErr: (s: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [agreedIn, setAgreedIn] = useState("");
  /** 줄별 편집 상태 — 품목 id → { price, reject } */
  const [edit, setEdit] = useState<Record<number, { price: string; reject: boolean }>>({});

  const changedAfter = l.currentStatus === "성사" && l.currentTotal !== l.billed && !l.applied && l.decision === "대기";

  const save = (decision: string, agreed?: number | null, items?: { quoteItemId: number; action: "반려" | "조정"; agreedPrice?: number | null }[]) =>
    start(async () => {
      onErr(null);
      const r = await saveDecision({
        lineId: l.lineId,
        decision: decision as "승인",
        agreed: agreed ?? null,
        matchedBy: "손으로",
        items,
      });
      if (!r.ok) return onErr(r.error);
      setOpen(false);
      router.refresh();
    });

  const saveItemEdits = () => {
    const items = l.items
      .map((it) => {
        const e = edit[it.id];
        if (!e) return null;
        if (e.reject) return { quoteItemId: it.id, action: "반려" as const };
        const p = e.price === "" ? it.price : Number(e.price);
        if (p !== it.price) return { quoteItemId: it.id, action: "조정" as const, agreedPrice: p };
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length === 0) return onErr("바꾼 줄이 없습니다");
    const anyReject = items.some((i) => i.action === "반려");
    save(anyReject ? "부분반려" : "조정", null, items);
  };

  const editedTotal = l.items.reduce((s, it) => {
    const e = edit[it.id];
    if (e?.reject) return s;
    const p = e && e.price !== "" ? Number(e.price) : it.price;
    return s + it.qty * p;
  }, 0);

  return (
    <li className={`rounded-2xl border bg-white p-3 ${l.applied ? "border-emerald-200" : "border-slate-200"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="tabular flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold">{l.quoteNo}</span>
            <span className="text-slate-500">{l.workDate.slice(5)}</span>
            {l.plateNo && (
              <span className="text-slate-600">
                {l.plateNo}
                {l.model ? ` ${l.model}` : ""}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {l.items.map((i) => i.description).join(" · ") || "품목 없음"}
          </div>
        </button>
        <div className="shrink-0 text-right">
          <div className="tabular text-sm font-semibold">
            {l.agreed != null && l.agreed !== l.billed ? (
              <>
                <span className="text-slate-400 line-through">{won(l.billed)}</span>{" "}
                <span className="text-sky-800">{won(l.agreed)}원</span>
              </>
            ) : (
              `${won(l.billed)}원`
            )}
          </div>
          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${DECISION_TONE[l.decision]}`}>
            {l.decision}
            {l.applied && " ✓"}
          </span>
        </div>
      </div>

      {l.paid > 0 && (
        <p className="tabular mt-1 text-xs text-amber-800">이미 받은 수금 {won(l.paid)}원 — 그보다 깎을 수 없습니다</p>
      )}
      {l.currentStatus === "취소" && <p className="mt-1 text-xs text-red-600">이 판매는 취소돼 있습니다</p>}
      {changedAfter && (
        <p className="tabular mt-1 text-xs text-orange-700">
          ⚠️ 정산 담은 뒤 앱에서 금액이 바뀌었습니다 (지금 {won(l.currentTotal)}원) — 판정 전에 확인해 주세요
        </p>
      )}
      {l.replyMemo && <p className="mt-1 truncate text-xs text-slate-400">회신: {l.replyMemo}</p>}

      {!locked && open && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={pending} onClick={() => save("승인")} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">
              승인 — 그대로
            </button>
            <button type="button" disabled={pending} onClick={() => save("보류")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600">
              보류
            </button>
            <button
              type="button"
              disabled={pending || l.paid > 0}
              onClick={() => save("반려")}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-40"
            >
              반려 — 판매 취소
            </button>
          </div>

          {/* 건 단위 합의금액 */}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={agreedIn === "" ? "" : Number(agreedIn).toLocaleString()}
              onChange={(e) => setAgreedIn(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder={`합의금액 (청구 ${won(l.billed)})`}
              className="tabular min-w-0 flex-1 rounded-lg border border-sky-300 px-3 py-2 text-right text-sm"
            />
            <button
              type="button"
              disabled={pending || agreedIn === ""}
              onClick={() => save("조정", Number(agreedIn))}
              className="shrink-0 rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              조정 저장
            </button>
          </div>

          {/* 줄별 고치기 — 특정 줄만 깎이거나 빠질 때 */}
          <div className="mt-2 rounded-xl bg-slate-50 p-2">
            <p className="text-xs font-medium text-slate-500">줄별로 고치기 (일부만 깎이거나 빠질 때)</p>
            <ul className="mt-1 space-y-1">
              {l.items.map((it) => {
                const e = edit[it.id] ?? { price: "", reject: false };
                return (
                  <li key={it.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEdit((v) => ({ ...v, [it.id]: { ...e, reject: !e.reject } }))}
                      className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                        e.reject ? "bg-red-600 text-white" : "bg-white text-red-600 ring-1 ring-red-300"
                      }`}
                    >
                      {e.reject ? "뺌" : "빼기"}
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-xs ${e.reject ? "text-slate-400 line-through" : "text-slate-700"}`}>
                      {it.description}
                      {it.qty > 1 && ` ×${it.qty}`}
                    </span>
                    <input
                      value={e.price === "" ? "" : Number(e.price).toLocaleString()}
                      onChange={(ev) => setEdit((v) => ({ ...v, [it.id]: { ...e, price: ev.target.value.replace(/\D/g, "") } }))}
                      inputMode="numeric"
                      disabled={e.reject}
                      placeholder={won(it.price)}
                      className="tabular w-24 shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs disabled:opacity-40"
                    />
                  </li>
                );
              })}
            </ul>
            <div className="tabular mt-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-500">고친 뒤 합계 {won(editedTotal)}원</span>
              <button
                type="button"
                disabled={pending}
                onClick={saveItemEdits}
                className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
              >
                줄별 판정 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/* ============================================================
 * 회신 반영 — 붙여넣기 · 엑셀 → 미리보기 → 판정 저장
 * ========================================================== */
function ReplySection({ runId, onErr }: { runId: number; onErr: (s: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ReplyPreview | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  /** 모호한 줄의 선택 — index → lineId (0 = 무시) */
  const [pick, setPick] = useState<Record<number, number>>({});

  const doPreview = () =>
    start(async () => {
      onErr(null);
      setPreview(null);
      const fd = new FormData();
      const f = fileRef.current?.files?.[0];
      if (f) fd.set("file", f);
      else fd.set("text", text);
      try {
        const r = await previewReply(runId, fd);
        if (!r.ok) return onErr(r.error);
        setPreview(r.preview);
        setChecked(Object.fromEntries(r.preview.matched.map((m) => [m.lineId, true])));
        setPick({});
      } catch {
        onErr("서버와 연결이 어긋났습니다 — 화면을 새로고침한 뒤 다시 시도해 주세요");
      }
    });

  const doSave = () =>
    start(async () => {
      onErr(null);
      if (!preview) return;
      const rows = [
        ...preview.matched
          .filter((m) => checked[m.lineId])
          .map((m) => ({ lineId: m.lineId, agreed: m.agreed, matchedBy: m.matchedBy, memo: m.memo })),
        ...preview.ambiguous
          .map((a, i) => ({ a, lineId: pick[i] }))
          .filter((x) => x.lineId > 0)
          .map((x) => ({ lineId: x.lineId, agreed: x.a.agreed, matchedBy: "손으로", memo: x.a.raw.slice(0, 100) })),
      ];
      if (rows.length === 0) return onErr("반영할 줄이 없습니다");
      const r = await saveMatchedDecisions(runId, rows);
      if (!r.ok) return onErr(r.error);
      setPreview(null);
      setText("");
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-2xl border border-dashed border-sky-300 bg-sky-50 py-3 text-sm font-medium text-sky-800"
      >
        📋 거래처 회신 올리기 — 엑셀 파일이나 표를 붙여넣으면 자동으로 이어 봅니다
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-sky-900">거래처 회신 반영</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 underline">
          닫기
        </button>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="mt-2 block w-full text-xs" />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="…또는 회신 표를 그대로 붙여넣기 (차량번호·금액이 있으면 됩니다)"
        className="mt-2 w-full rounded-xl border border-sky-200 bg-white p-2 text-xs"
      />
      <button
        type="button"
        disabled={pending}
        onClick={doPreview}
        className="mt-2 w-full rounded-control bg-sky-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "읽는 중…" : "미리보기"}
      </button>

      {preview && (
        <div className="mt-3">
          <p className="text-xs text-slate-600">
            읽은 줄 {preview.parsedCount} — 이어진 판매 {preview.matched.length}건
            {preview.ambiguous.length > 0 && ` · 골라야 할 것 ${preview.ambiguous.length}건`}
            {preview.unmatched.length > 0 && ` · 못 이은 줄 ${preview.unmatched.length}`}
            {(preview.noMark?.length ?? 0) > 0 && ` · 표시 없어 그대로 둔 것 ${preview.noMark!.length}건`}
          </p>
          <ul className="mt-1.5 max-h-72 space-y-1 overflow-y-auto">
            {preview.matched.map((m) => {
              const delta = m.agreed != null ? m.agreed - m.billed : 0;
              return (
                <li key={m.lineId} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!!checked[m.lineId]}
                    onChange={(e) => setChecked((v) => ({ ...v, [m.lineId]: e.target.checked }))}
                    className="h-4 w-4 accent-sky-700"
                  />
                  <span className="tabular min-w-0 flex-1 truncate">
                    <strong>{m.quoteNo}</strong> {m.workDate.slice(5)} {m.plateNo ?? ""}
                    <span className="ml-1 text-slate-400">({m.matchedBy})</span>
                  </span>
                  <span className="tabular shrink-0 text-right">
                    {/* 승인금액 0 = 거래처 반려 (청구서의 승인금액 칸·비고 「반려」) */}
                    {m.decision === "반려" || m.agreed === 0 ? (
                      <span className="font-semibold text-red-700">반려 — 판매 취소</span>
                    ) : m.agreed == null || m.agreed === m.billed ? (
                      <span className="text-emerald-700">{won(m.billed)} 그대로</span>
                    ) : (
                      <span className={delta < 0 ? "font-semibold text-red-600" : "font-semibold text-sky-700"}>
                        {won(m.billed)} → {won(m.agreed)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            {preview.ambiguous.map((a, i) => (
              <li key={`amb-${i}`} className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs">
                <p className="truncate text-amber-900">{a.raw}</p>
                <select
                  value={pick[i] ?? 0}
                  onChange={(e) => setPick((v) => ({ ...v, [i]: Number(e.target.value) }))}
                  className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-1"
                >
                  <option value={0}>무시 (안 이음)</option>
                  {a.candidates.map((c) => (
                    <option key={c.lineId} value={c.lineId}>
                      {c.quoteNo} · {c.workDate.slice(5)} · {c.plateNo ?? "?"} · {won(c.billed)}원
                    </option>
                  ))}
                </select>
              </li>
            ))}
            {preview.unmatched.map((u, i) => (
              <li key={`un-${i}`} className="truncate rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-400">
                못 이음: {u}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pending}
            onClick={doSave}
            className="mt-2 w-full rounded-control bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            체크한 것 판정으로 저장
          </button>
          <p className="mt-1 text-xs text-slate-500">저장해도 판매는 아직 안 바뀝니다 — 아래 「한꺼번에 적용」이 실제 반영입니다.</p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 입금 반영 — settleReceivables 정본 그대로 (오래된 건부터 배분)
 * ========================================================== */
function DepositSection({
  runId,
  remain,
  onErr,
  ask,
}: {
  runId: number;
  remain: number;
  onErr: (s: string | null) => void;
  ask: (o: { title: string; body: string; confirmLabel: string }) => Promise<boolean>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("계좌이체");
  const [paidOn, setPaidOn] = useState(new Date().toLocaleDateString("sv-SE"));
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const received = amount === "" ? remain : Number(amount);

  const go = async () => {
    const ok = await ask({
      title: "입금을 반영할까요?",
      body: `${won(received)}원을 이 회차의 외상 건들에 오래된 것부터 나눠 넣습니다 (한꺼번에 털기와 같은 방식).`,
      confirmLabel: "입금 반영",
    });
    if (!ok) return;
    start(async () => {
      onErr(null);
      const r = await markDeposited({ runId, method, paidOn, received: amount === "" ? null : received });
      if (!r.ok) return onErr(r.error);
      setMsg(
        `${won(r.applied)}원 반영 — ${r.settled}건${r.partialQuoteNo ? ` · ${r.partialQuoteNo} 은(는) 잔액 남음` : " · 전부 완납"}`,
      );
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-2xl border border-emerald-300 bg-emerald-50 py-3 text-sm font-semibold text-emerald-800"
      >
        💰 입금 반영 — 미수 {won(remain)}원
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3">
      {msg && <p className="mb-2 rounded-lg bg-white px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {SPLITTABLE.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              method === m ? "bg-emerald-800 text-white" : "bg-white text-emerald-900 ring-1 ring-emerald-300"
            }`}
          >
            {m}
          </button>
        ))}
        <input
          type="date"
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
          className="tabular rounded-lg border border-emerald-300 px-2 py-1.5 text-xs"
        />
      </div>
      <input
        value={amount === "" ? "" : Number(amount).toLocaleString()}
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        placeholder={`받은 금액 (비우면 ${won(remain)} 전액)`}
        className="tabular mt-2 w-full rounded-lg border border-emerald-300 px-3 py-2 text-right text-sm"
      />
      <button
        type="button"
        disabled={pending || received <= 0 || received > remain}
        onClick={go}
        className="mt-2 w-full rounded-control bg-emerald-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "넣는 중…" : `${won(Math.min(received, remain))}원 입금 반영`}
      </button>
      {received > remain && (
        <p className="mt-1 text-xs text-red-700">미수({won(remain)}원)보다 많이 넣을 수 없습니다</p>
      )}
    </div>
  );
}
