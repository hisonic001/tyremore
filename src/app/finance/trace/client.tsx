"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { traceLinkDeposit } from "@/lib/trace-actions";
import { useConfirm } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";

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

/** 판매 ↔ 입금 잇기 — 후보가 하나뿐일 때만 서버가 내려보낸다 */
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
      title: "이 입금과 이을까요?",
      body: `${title} ${won(amount)}원 ↔ ${action.label}\n입금 정리와 같은 방식으로 이어지고, 입금자명도 이 상대로 기억합니다.`,
      confirmLabel: "잇기",
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
