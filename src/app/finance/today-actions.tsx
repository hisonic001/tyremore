"use client";

/**
 * ⭐ 첫 화면 「오늘」 칸의 단추들 (돈관리 개편 1단계, 2026-09-11)
 *
 *   원칙: 한 줄 = 무엇 · 숫자 · 단추 하나. 여기 단추는 전부 **기존 정본 액션**을 부른다 —
 *   잇기는 추적 화면의 TraceLinkButton 그대로, 「개인계좌 / 현금 / 기다림」은 입금 화면과
 *   같은 markSaleSettledAside · fixSaleMethod. 새 논리 없음.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSaleSettledAside } from "@/lib/trace-actions";
import { fixSaleMethod } from "@/lib/pos-actions";
import { setInvoiceDeadlineSkip } from "@/lib/invoice-deadline-actions";
import { useConfirm } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";
import { TraceLinkButton } from "./trace/client";
import type { A1Row } from "@/lib/self-audit";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 안 들어온 이체 한 줄 — [⚡짝][개인계좌][현금][기다림] */
export function TransferRow({ t }: { t: A1Row }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const title = `${t.d.slice(5)} ${t.who}`;

  const act = async (label: string, body: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    const ok = await ask({ title: label, body, confirmLabel: "네" });
    if (!ok) return;
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "실패");
      router.refresh();
    });
  };
  const btn = "rounded-full border px-2 py-0.5 text-[11px] font-medium disabled:opacity-40";

  return (
    <li className="py-1">
      {confirmDialog}
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm">
          <span className="tabular text-xs text-slate-400">{t.d.slice(5)}</span> {t.who}
        </span>
        <span className="tabular shrink-0 text-sm font-semibold">{won(t.total)}원</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        {t.cand ? (
          <TraceLinkButton action={{ cashTxnId: t.cand.cashTxnId, quoteId: t.quoteId, label: t.cand.label }} title={title} amount={t.total} />
        ) : (
          <span className="text-[11px] text-slate-400">동액 입금 없음</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act("개인 통장으로 받았나요?", `${title} ${won(t.total)}원 — 법인 통장에 안 찍히는 돈이라 확인 끝으로 표시합니다.`, () =>
              markSaleSettledAside(t.quoteId, false, "개인통장 입금"),
            )
          }
          className={`${btn} border-brand-400 bg-brand-50 text-brand-700`}
        >
          개인계좌
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => act("현금으로 받았나요?", `${title} ${won(t.total)}원 — 결제수단을 현금으로 고칩니다.`, () => fixSaleMethod(t.quoteId, "현금"))}
          className={`${btn} border-slate-300 bg-white text-slate-600`}
        >
          현금
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            act("아직 안 들어온 돈으로 둘까요?", `${title} ${won(t.total)}원 — 목록에서 빠집니다. 들어오면 「최근 한 일」에서 되돌려 이으세요.`, () =>
              markSaleSettledAside(t.quoteId, false, "아직 안 들어옴"),
            )
          }
          className={`${btn} border-slate-300 bg-white text-slate-600`}
        >
          기다림
        </button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

/**
 * 계산서 짝 없음 줄의 넘기기 — 「이번 달은 안 끊음」 / 「늘 안 끊는 곳」
 * 사장님(2026-09-11): "거래처마다 다르기도 하고 같은 거래처에서도 건마다 다르기 때문에 유동적임."
 */
export function InvoiceSkipButton({ supplier, ym }: { supplier: string; ym: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const go = async (scope: "month" | "always") => {
    const ok = await ask({
      title: scope === "month" ? "이번 달은 계산서를 안 끊나요?" : "이 거래처는 늘 계산서를 안 끊나요?",
      body:
        scope === "month"
          ? `${supplier} — ${Number(ym.slice(5, 7))}월분만 경고에서 뺍니다. 다음 달엔 다시 봅니다.`
          : `${supplier} — 앞으로 계산서 경고에서 계속 뺍니다.`,
      confirmLabel: scope === "month" ? "이번 달만" : "늘 안 끊음",
    });
    if (!ok) return;
    start(async () => {
      setError(null);
      const r = await setInvoiceDeadlineSkip(supplier, scope, ym);
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      {confirmDialog}
      <button type="button" disabled={pending} onClick={() => go("month")} className="text-[11px] text-slate-500 underline disabled:opacity-40">
        이번 달은 안 끊음
      </button>
      <button type="button" disabled={pending} onClick={() => go("always")} className="text-[11px] text-slate-400 underline disabled:opacity-40">
        늘 안 끊는 곳
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </span>
  );
}
