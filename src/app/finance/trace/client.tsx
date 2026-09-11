"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { markSaleSettledAside, traceLinkDeposit } from "@/lib/trace-actions";
import { useConfirm } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";
// ⭐ 화면 글자는 fin-words 정본 (ERP 용어, 2026-09-12): 잇기→대사, 확인 끝→대사 제외
import { W } from "@/lib/fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 검색칸 — 주소(?q=)로 넘겨 서버가 찾는다 */
export function TraceSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const go = () => router.push(`/finance/trace${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="flex min-h-11 flex-1 items-center gap-2 rounded-control border border-slate-300 bg-white px-3">
        <Search className="size-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="이름 · 금액 · 무엇이든  (예: 미광 · 280000)"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <button type="button" onClick={go} className="min-h-11 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white">
        찾기
      </button>
    </div>
  );
}

/** 판매 ↔ 입금 대사 — 후보가 하나뿐일 때만 서버가 내려보낸다 */
export function TraceLinkButton({
  action,
  title,
  amount,
}: {
  action: { cashTxnId: number; quoteId: number; label: string };
  title: string;
  amount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const ok = await ask({
      title: `이 입금과 ${W.recon}할까요?`,
      body: `${title} ${won(amount)}원 ↔ ${action.label}\n${W.reconDeposit}와 같은 방식으로 ${W.recon}되고, 입금자명도 이 상대로 기억합니다.`,
      confirmLabel: W.recon,
    });
    if (!ok) return;
    start(async () => {
      setError(null);
      const r = await traceLinkDeposit(action.cashTxnId, action.quoteId);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <div className="mt-1.5">
      {confirmDialog}
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        ⚡ {action.label}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** 통장에 안 찍히는 수령(개인계좌·현금) — 인박스와 같은 정본(markSaleSettledAside).
 *  사장님 제보 2026-09-02: 렉카(상혁) — 이 버튼이 인박스에만 있어서 검사 목록에선 처리할 길이 없었다. */
export function TraceAsideButton({ quoteId, title, amount }: { quoteId: number; title: string; amount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const ok = await ask({
      title: "개인계좌·현금으로 받은 판매인가요?",
      body: `${title} ${won(amount)}원
법인 통장에 안 찍히는 돈이라 ${W.excluded}로 표시합니다. 잘못 표시했으면 아래 「통장 밖에서 정리한 판매」에서 되돌릴 수 있습니다.`,
      confirmLabel: `받았음 — ${W.excluded}`,
    });
    if (!ok) return;
    start(async () => {
      setError(null);
      const r = await markSaleSettledAside(quoteId);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <span className="inline-block">
      {confirmDialog}
      <button
        type="button"
        disabled={pending}
        onClick={go}
        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-40"
      >
        개인계좌·현금으로 받음
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </span>
  );
}

/**
 * ⭐ 되돌리기 (2026-09-10) — `markSaleSettledAside(quoteId, true)` 는 처음부터 서버에 있었지만
 *   **부르는 곳이 한 곳도 없었다.** 그래서 인박스·추적 화면의 "되돌릴 수 있습니다" 안내가
 *   거짓말이었다. 되돌리면 그 판매는 다시 「확인할 것」으로 올라온다.
 */
export function TraceAsideUndoButton({ quoteId, title, amount }: { quoteId: number; title: string; amount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    const ok = await ask({
      title: "이 표시를 되돌릴까요?",
      body: `${title} ${won(amount)}원
「확인할 것」 목록으로 다시 올라옵니다 — 통장 입금이 올라왔으면 그 자리에서 ${W.recon}하시면 됩니다.`,
      confirmLabel: "되돌리기",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      setError(null);
      const r = await markSaleSettledAside(quoteId, true);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <span className="inline-block">
      {confirmDialog}
      <button type="button" disabled={pending} onClick={go} className="text-xs text-slate-400 underline disabled:opacity-40">
        되돌리기
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </span>
  );
}

