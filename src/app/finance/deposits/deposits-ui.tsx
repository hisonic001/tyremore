"use client";

import { useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { DepositReconData, DepositSuggestion } from "@/lib/recon-data";
import type { DepositBreakdown, DepositTaxBundles, DepositTaxCands, TransferSale } from "@/lib/deposit-tax";
import { clearPosNote, fixSaleMethod } from "@/lib/pos-actions";
import { markSaleSettledAside } from "@/lib/trace-actions";
import {
  collectFromDeposit,
  confirmSureDeposits,
  linkDepositsToQuote,
  linkDepositToQuote,
  markCardSettlements,
  setDepositKind,
} from "@/lib/fin-deposits";
import { confirmBankToTaxes, confirmTaxToBank } from "@/lib/recon";
import { BankSearch } from "../tax/link-parts";
import { LearnCheck } from "@/components/fin/learn-check";
import { won } from "@/components/fin/money";
import { useConfirm, type ConfirmOpts } from "@/components/ui/confirm";
import { W, autoReconLabel } from "@/lib/fin-words";

/* ───────────────────────── 공통 손잡이 (개편 3단계, 2026-09-12 — 조각으로 승격) ─────────────────────────
   DepositsRecon 안에 있던 진행 상태·액션 실행·안내·확인 시트를 훅으로 빼서, 기존 화면과
   「이번 주 정리」 흐름(③)이 같은 카드 조각(DepositCard·TransferSalesList)을 쓴다. 동작은 전과 같다. */

export interface DepositCtx {
  pending: boolean;
  act: (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: (r: never) => string) => void;
  /**
   * 미수금 상대에 수금 등록 (확인 시트 → collectFromDeposit)
   * ⭐ learn = 「다음부터 자동으로」(개편 4단계, 2026-09-12) — 카드가 가진 체크칸 값을 그대로 넘긴다.
   *    안 넘기면 켜진 것으로 본다(기본 켜짐 — 지금까지의 동작).
   */
  collect: (s: DepositSuggestion, key: string, label: string, remain: number, learn?: boolean) => Promise<void>;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
  msg: string | null;
  error: string | null;
  /** 안내 띠 자리 — 실패했을 때 그 자리로 데려간다 */
  banner: RefObject<HTMLDivElement | null>;
  /** 확인 시트 노드 — 화면 맨 아래에 한 번 그린다 */
  confirmDialog: ReactNode;
}

export function useDepositCtx(): DepositCtx {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치5 — 브라우저 confirm() 대체
  /* 🔴 안내는 화면 맨 위에 뜨는데 단추는 한참 아래다 — 실패해도 「눌러도 아무 일이 없다」로 보인다
        (사장님 제보 2026-08-29). 실패했을 때만 그 자리로 데려간다. */
  const banner = useRef<HTMLDivElement>(null);

  const act: DepositCtx["act"] = (fn, okMsg) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(String((r as { error?: string }).error ?? "실패했습니다"));
        banner.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      setMsg(okMsg(r as never));
      router.refresh();
    });

  const collect: DepositCtx["collect"] = async (s, key, label, remain, learn = true) => {
    const take = Math.min(s.dep.amount, remain);
    if (
      !(await ask({
        title: `${label} 수금으로 등록할까요?`,
        body: `${W.receivable} ${won(take)}원을 오래된 건부터 차례로 채웁니다.${
          s.dep.amount > remain ? `\n입금이 잔액보다 커서 ${won(s.dep.amount - remain)}원이 남습니다.` : ""
        }`,
        confirmLabel: "수금 등록",
      }))
    )
      return;
    act(
      () => collectFromDeposit(s.dep.id, key, { learn }),
      (r: { applied: number; settled: number; leftover: number }) =>
        `수금 ${won(r.applied)}원 등록 — ${r.settled}건 완납${r.leftover > 0 ? ` · 남은 ${won(r.leftover)}원은 배분 안 됨` : ""}`,
    );
  };

  return { pending, act, collect, ask, msg, error, banner, confirmDialog };
}

/** 안내 띠 — 실패·성공 한 줄 (ref 는 ctx.banner) */
export function DepositBanner({ ctx }: { ctx: DepositCtx }) {
  return (
    <div ref={ctx.banner}>
      {ctx.error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {ctx.error}</p>}
      {ctx.msg && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {ctx.msg}</p>}
    </div>
  );
}

/** 카드 정산 일괄 — 적요 FB자금·매출표 */
export function CardSettleBanner({ data, ym, ctx }: { data: DepositReconData; ym: string; ctx: DepositCtx }) {
  if (data.cardPatternCount <= 0) return null;
  return (
    <section className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
      <p className="text-sm text-sky-900">
        카드 정산으로 보이는 입금(적요 FB자금·매출표)이{" "}
        <strong className="tabular">
          {data.cardPatternCount}건 · {won(data.cardPatternSum)}원
        </strong>{" "}
        있습니다
      </p>
      <button
        type="button"
        disabled={ctx.pending}
        onClick={() =>
          ctx.act(
            () => markCardSettlements(ym),
            (r: { marked: number }) => `${r.marked}건을 카드 정산으로 표시했습니다.`,
          )
        }
        className="mt-2 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        모두 카드 정산으로 표시
      </button>
    </section>
  );
}

/** 입금 카드 한 장 — 계산서 묶음·계산서 후보·미수금 수금·판매 후보·성격 고르기. `<li>` 를 그린다 */
export function DepositCard({
  s,
  ym,
  sure,
  taxCands,
  bundles,
  ctx,
}: {
  s: DepositSuggestion;
  ym: string;
  /** 짝 확실 표시(테두리·배지) */
  sure: boolean;
  taxCands: DepositTaxCands;
  bundles: DepositTaxBundles;
  ctx: DepositCtx;
}) {
  const { pending, act, collect } = ctx;
  /**
   * ⭐ 「다음부터 자동으로」 (개편 4단계, 2026-09-12 — 사장님 결정 7, **기본 켜짐**)
   *    카드 한 장에 하나다. 이 카드에서 무엇으로 맞추든(계산서·판매·수금·성격) 같은 값을 쓴다 —
   *    사장님이 보는 건 「이 입금의 상대」 하나이므로, 자리마다 체크칸을 두면 어느 것이 적용됐는지
   *    매번 생각해야 한다. 체크칸은 아래 단추줄(성격 고르기)에 한 줄로 붙는다.
   */
  const [learn, setLearn] = useState(true);
  return (
    <li className={`rounded-2xl border bg-white p-4 ${sure ? "border-brand-500" : "border-slate-200"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="tabular text-xs text-slate-400">{s.dep.at}</span>{" "}
          <span className="font-medium">{s.dep.description}</span>
          {sure && (
            <span className="ml-1.5 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">짝 확실</span>
          )}
        </span>
        <span className="tabular shrink-0 font-bold text-emerald-700">+{won(s.dep.amount)}원</span>
      </div>

      {/* ⭐ 입금 한 줄 = 계산서 여러 장 (레드캡 624,800 = 528,000 + 96,800) */}
      {bundles[s.dep.id] && (
        <div className="mt-2 rounded-lg bg-brand-50 p-2 text-sm">
          <p className="text-xs font-semibold text-brand-700">
            ✔ 이 입금은 계산서 {bundles[s.dep.id].invoiceIds.length}장 합({bundles[s.dep.id].parts.join(" + ")})과{" "}
            {bundles[s.dep.id].diff === 0
              ? "정확히 맞습니다"
              : `${won(Math.abs(bundles[s.dep.id].diff))}원 차이(수수료·반올림 — 자동 정리)`}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => confirmBankToTaxes(s.dep.id, bundles[s.dep.id].invoiceIds, { learn }),
                (r: { applied: number }) => `계산서 ${r.applied}장을 이 입금 하나에 ${W.recon}했습니다.`,
              )
            }
            className="mt-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            이 입금으로 {bundles[s.dep.id].invoiceIds.length}장 한꺼번에 {W.recon}
          </button>
        </div>
      )}
      {/* ⭐ 세금계산서 바로 대조 (사장님 요청 2026-08-26) — 전엔 "계산서 화면에서 이으세요"만 있고 버튼이 없었다 */}
      {(taxCands[s.dep.id]?.length ?? 0) > 0 && (
        <div className="mt-2 rounded-lg bg-violet-50 p-2 text-sm">
          <p className="text-xs text-violet-900">
            세금계산서 대금으로 보입니다 — 맞는 계산서와 {W.recon}하세요
            {taxCands[s.dep.id].some((c) => c.direction === "매입") && ` (↔ = 수수료를 떼고 받은 정산, 매입 계산서와 ${W.offset})`}
          </p>
          <ul className="mt-1 space-y-1">
            {taxCands[s.dep.id].map((c) => (
              <li key={c.invId} className="flex items-center justify-between gap-2">
                <span className="tabular min-w-0 truncate text-xs">{c.label}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => confirmTaxToBank(c.invId, s.dep.id, { learn }),
                      (r: { remaining: number; shortfall: number }) =>
                        r.shortfall > 0
                          ? `${W.recon}했습니다 — 계산서에 ${won(r.shortfall)}원이 남았습니다 (다른 입금을 이어서 ${W.recon}하거나 계산서 화면에서 「${W.done}」)`
                          : r.remaining > 0
                            ? `${W.recon}했습니다 — 이 입금에 ${won(r.remaining)}원이 남았습니다 (다른 계산서 몫이면 이어서)`
                            : `${W.recon}했습니다 — 금액이 정확히 맞습니다.`,
                    )
                  }
                  className={`shrink-0 rounded-control px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                    c.exact && c.known ? "bg-brand-600 text-white active:bg-brand-700" : "border border-slate-300 bg-white"
                  }`}
                >
                  이 계산서와 {W.recon}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.taxHint && !(taxCands[s.dep.id]?.length > 0) && (
        <p className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-800">
          ★ {s.taxHint} — 열린 계산서가 이 달 근처에 없습니다. 계산서가 아직 안 올라왔으면 나중에, 아니면 아래에서 분류하세요
        </p>
      )}
      {s.parties.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">
          <p className="text-xs text-amber-900">이름이 닮은 {W.receivable} 상대 — 수금이면 바로 등록하세요</p>
          <ul className="mt-1 space-y-1">
            {s.parties.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-2">
                <span className="tabular min-w-0 truncate text-xs">
                  {p.key.startsWith("S:") || p.key.startsWith("C:") ? (
                    <Link
                      href={`/finance/party/${encodeURIComponent(p.key)}?ym=${ym}`}
                      className="underline-offset-2 hover:underline"
                      title="이 상대의 원장 보기"
                    >
                      {p.label}
                    </Link>
                  ) : (
                    p.label
                  )}{" "}
                  · 잔액 {won(p.remain)}원 ({p.count}건)
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => collect(s, p.key, p.label, p.remain, learn)}
                  className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                >
                  수금 등록
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.quotes.length > 0 && (
        <div className="mt-2 text-sm">
          <p className="text-xs text-slate-500">
            같은 금액의 판매 — 같은 건이면 {W.recon}하세요 (앱에 카드·현금으로 적혀 있어도 실제 이체였으면 {W.recon})
          </p>
          <ul className="mt-1 space-y-1">
            {s.quotes.map((q) => (
              <li key={q.quoteId} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs">{q.label}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(() => linkDepositToQuote(s.dep.id, q.quoteId, { learn }), () => `${W.recon}했습니다.`)
                  }
                  className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium"
                >
                  {W.recon}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.parties.length === 0 && s.quotes.length === 0 && !(taxCands[s.dep.id]?.length > 0) && (
        <p className="mt-2 text-xs text-slate-400">
          판매·계산서·{W.receivable} 짝을 못 찾았습니다 — 계산서가 나중에 올라오면 다시 나타나고, 판매와 무관한 돈이면 아래에서 골라 주세요
        </p>
      )}

      {/* 「무시」 대신 무엇인지 고르기 (사장님 요청 2026-08-26) — 앱에 기록 없는 판매 대금이 가장 흔하다 */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5 text-xs">
        {/* ⭐ 체크칸 한 줄 (개편 4단계) — 이 카드의 모든 맞추기·성격 고르기에 함께 걸린다 */}
        <LearnCheck value={learn} onChange={setLearn} disabled={pending} className="mr-auto" />
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => setDepositKind(s.dep.id, "판매입금", { learn }), () => `「판매 대금(앱 기록 없음)」으로 정리 — 손익의 ${W.sales}에 들어갑니다.`)}
          title={`앱에 판매 기록이 없는 대금 — 손익에 ${W.sales}로 잡히고, 나중에 정비내역을 등록하면 되돌려 ${W.recon}하면 됩니다`}
          className="rounded-full border border-brand-500 bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700 active:bg-brand-100 disabled:opacity-40"
        >
          판매 대금 (앱 기록 없음)
        </button>
        <span className="text-slate-400">· 판매와 무관하면:</span>
        {(["이자·지원금", "환불", "기타입금"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={pending}
            onClick={() => act(() => setDepositKind(s.dep.id, k, { learn }), () => `「${k}」으로 정리했습니다.`)}
            className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 active:bg-slate-100 disabled:opacity-40"
          >
            {k}
          </button>
        ))}
      </div>
    </li>
  );
}

/** ⭐ 계좌이체로 적혔는데 법인 통장에 없는 판매 (사장님 제보 2026-08-26 — 개인 통장으로 보내는 손님)
 *  @param saleHref 흐름(③)에서만 — 그 날 정비 내역으로 나가는 링크(`W.goRegisterSale`). 기존 화면은 안 넘긴다 */
export function TransferSalesList({
  transfers,
  ctx,
  saleHref,
}: {
  transfers: TransferSale[];
  ctx: DepositCtx;
  saleHref?: (day: string) => string;
}) {
  const { pending, act } = ctx;
  if (transfers.length === 0) return null;
  return (
    <section className="mt-4 rounded-2xl border border-amber-300 bg-white p-4">
      <h2 className="text-sm font-semibold">
        앱엔 「계좌이체」인데 통장에서 짝을 못 찾은 판매 {transfers.filter((t) => !t.note).length}건
        {transfers.some((t) => t.note) && <span className="font-normal text-slate-400"> · 사유 남김 {transfers.filter((t) => t.note).length}건</span>}
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">
        같은 금액이나 같은 이름의 입금이 있으면 아래에 후보로 뜹니다(나눠 받은 것은 묶음으로). 후보가 없으면 다른 이름으로
        왔거나 개인 통장·현금이었을 수 있어요 — 「통장에서 찾기」로 찾거나 사유를 남기면 됩니다.
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {transfers.map((t) => (
          <li key={t.key} className={`rounded-lg border p-2 ${t.note ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="tabular min-w-0 truncate text-xs">
                <span className="text-slate-400">{t.day.slice(5)}</span> {t.quoteNo} · {t.who}
                {t.linked > 0 && <span className="ml-1 text-sky-700">· {won(t.linked)}원은 {W.recon}됨, 남은 {won(t.amount - t.linked)}원</span>}
              </span>
              <strong className="tabular shrink-0">{won(t.amount)}원</strong>
            </div>
            {t.note ? (
              <p className="mt-1 flex items-center justify-between text-xs text-slate-500">
                <span>{t.note.reason}{t.note.memo ? ` — ${t.note.memo}` : ""}</span>
                <button type="button" disabled={pending} onClick={() => act(() => clearPosNote(t.key), () => "되돌렸습니다.")} className="underline">되돌리기</button>
              </p>
            ) : (
              <div className="mt-1 space-y-1 text-xs">
                {t.bundle && (
                  <div className="flex items-center justify-between gap-2 rounded bg-brand-50 p-1.5">
                    <span className="min-w-0 truncate font-semibold text-brand-700">
                      ✔ 나눠 받음 — 입금 {t.bundle.cashIds.length}줄 합({t.bundle.parts.join(" + ")}){t.bundle.diff === 0 ? "이 정확히 맞습니다" : ` · ${won(Math.abs(t.bundle.diff))}원 차이`}
                    </span>
                    <button type="button" disabled={pending} onClick={() => act(() => linkDepositsToQuote(t.quoteId, t.bundle!.cashIds), (r: { applied: number }) => `입금 ${r.applied}줄을 이 판매에 ${W.recon}했습니다.`)}
                      className="shrink-0 rounded-control bg-brand-600 px-2.5 py-1 font-semibold text-white active:bg-brand-700 disabled:opacity-40">{t.bundle.cashIds.length}줄 한꺼번에 {W.recon}</button>
                  </div>
                )}
                {t.cands.map((c) => (
                  <div key={c.cashId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{c.exact ? "같은 금액" : "같은 이름"}: {c.label}</span>
                    <button type="button" disabled={pending} onClick={() => act(() => linkDepositToQuote(c.cashId, t.quoteId), () => `${W.recon}했습니다.`)}
                      className={`shrink-0 rounded-control px-2.5 py-1 font-semibold disabled:opacity-40 ${c.exact && c.nameOk ? "bg-brand-600 text-white active:bg-brand-700" : "border border-slate-300 bg-white"}`}>이 입금과 {W.recon}</button>
                  </div>
                ))}
                <details>
                  <summary className="cursor-pointer text-slate-500 underline underline-offset-2">통장에서 찾기 (다른 이름·다른 금액으로 왔을 때)</summary>
                  <div className="mt-1">
                    <BankSearch direction="매출" pending={pending} onPick={(id) => act(() => linkDepositToQuote(id, t.quoteId), () => `${W.recon}했습니다.`)} anchor={t.day} />
                  </div>
                </details>
                {/* 🔴 2026-09-10: 이 두 단추는 이제 사유(pos_note)가 아니라 **대조 내역**을 남긴다
                    (markSaleSettledAside) — 전엔 여기서만 사라지고 감사·홈 인박스·추적 화면엔
                    영원히 남았다. 되돌리기는 「최근 한 일」(/finance/activity)에 있다 (2단계, 2026-09-12). */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <button type="button" disabled={pending}
                    onClick={() => act(() => markSaleSettledAside(t.quoteId, false, "개인통장 입금"), () => "「개인 통장으로 받음」으로 정리했습니다 — 모든 화면에서 빠집니다.")}
                    className="rounded-full border border-brand-500 bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700 disabled:opacity-40">개인 통장으로 받음</button>
                  <button type="button" disabled={pending}
                    onClick={() => act(() => fixSaleMethod(t.quoteId, "현금"), () => "결제수단을 현금으로 고쳤습니다.")}
                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 disabled:opacity-40">현금으로 받음 (수단 고치기)</button>
                  <button type="button" disabled={pending}
                    onClick={() => act(() => markSaleSettledAside(t.quoteId, false, "아직 안 들어옴"), () => `「아직 안 들어옴」으로 정리했습니다 — 들어오면 ${W.activity}에서 되돌리고 ${W.recon}하세요.`)}
                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600 disabled:opacity-40">아직 안 들어옴</button>
                  {/* ⭐ 흐름(③)에서만 — 밖으로 나가는 유일한 링크. 그 날 정비 내역(?back=weekly 로 돌아온다). 2026-09-12 */}
                  {saleHref && (
                    <Link href={saleHref(t.day)} className="rounded-control border border-slate-300 bg-white px-2.5 py-1 font-medium">
                      {W.goRegisterSale} →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ⭐ 통장 입금을 카드 정산·이체 판매·외상 수금으로 정리 (ERP 4단계, 2026-08-24)
 *   화면 글자는 fin-words 정본(ERP 용어, 2026-09-12) — 잇기→대조, 번 돈→매출.
 *   🔴 개편 3단계(2026-09-12): 위 조각(useDepositCtx·CardSettleBanner·DepositCard·TransferSalesList)으로
 *      재조립 — 모양·동작은 전과 같다. */
export function DepositsRecon({
  data,
  ym,
  taxCands,
  bundles,
  sureIds,
  breakdown,
  transfers,
}: {
  data: DepositReconData;
  ym: string;
  /** 입금 id → 열린 계산서 후보 (같은 상대·같은 금액) */
  taxCands: DepositTaxCands;
  /** 입금 id → 계산서 여러 장 합이 입금과 맞는 묶음 */
  bundles: DepositTaxBundles;
  /** 앱엔 계좌이체인데 법인 통장에 없는 판매 */
  transfers: TransferSale[];
  /** 짝이 확실한 입금 id — 한 번에 대조 */
  sureIds: number[];
  breakdown: DepositBreakdown;
}) {
  const sureSet = new Set(sureIds);
  const ctx = useDepositCtx();
  const { pending, act } = ctx;

  return (
    <>
      <DepositBanner ctx={ctx} />

      {/* 카드 정산 일괄 */}
      <CardSettleBanner data={data} ym={ym} ctx={ctx} />

      <section className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular">
          정리할 입금 <strong>{data.openTotal}건</strong>
          {data.openTotal > 0 && (
            <span className="text-xs text-slate-500">
              {" "}(계산서 짝 {breakdown.tax} · 판매 짝 {breakdown.quote} · {W.receivable} {breakdown.party} · {W.open} {breakdown.none})
            </span>
          )}
          {data.openTotal > data.open.length && ` · 최근 ${data.open.length}건 표시`} · {W.done} {data.doneCount}건 · {W.ignore}{" "}
          {data.ignoredCount}건
        </span>
        {/* ⭐ 짝이 확실한 것 한 번에 (사장님 요청 2026-08-26) */}
        {sureIds.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => confirmSureDeposits(ym),
                (r: { tax: number; quote: number; failed: number }) =>
                  `${autoReconLabel(r.tax + r.quote)} 완료 (계산서 ${r.tax} · 판매 ${r.quote})${r.failed > 0 ? ` · ${r.failed}건은 실패` : ""}.`,
              )
            }
            className="shrink-0 rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            ✔ {autoReconLabel(sureIds.length)}
          </button>
        )}
      </section>

      {/* 🔴 2026 감사 R5: 「자료 없음」과 「다 됐다」를 가른다 */}
      {data.open.length === 0 && data.cardPatternCount === 0 && (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.monthInCount === 0 ? (
            <>
              {Number(ym.slice(5, 7))}월 통장 내역이 아직 안 올라왔습니다 —{" "}
              <Link href={`/finance/upload?ym=${ym}`} className="underline">내역 올리기</Link>
            </>
          ) : (
            <>
              {Number(ym.slice(5, 7))}월 입금은 다 정리됐습니다 🎉 — 다음은{" "}
              <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold underline">지출 분류 →</Link>
            </>
          )}
        </section>
      )}

      <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {data.open.map((s) => (
          <DepositCard key={s.dep.id} s={s} ym={ym} sure={sureSet.has(s.dep.id)} taxCands={taxCands} bundles={bundles} ctx={ctx} />
        ))}
      </ul>

      {/* ⭐ 계좌이체로 적혔는데 법인 통장에 없는 판매 */}
      <TransferSalesList transfers={transfers} ctx={ctx} />

      {/* ⭐ 개편 2단계(2026-09-12) — 이 달에 한 일(통장 밖 정리·분류·카드정산 표시·판매·수금 대조)의
          되돌리기는 「최근 한 일」 한 곳으로 모았다. 전엔 접힌 표 4개가 여기 있었다(결정 f). */}
      <p className="mt-4 text-xs text-slate-400">
        잘못 {W.recon}한 입금·분류·카드정산 표시는{" "}
        <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
        {" "}— 되돌리면 수금 기록까지 함께 풀립니다.
      </p>
      <p className="mt-2 text-sm">
        다음 단계:{" "}
        <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          지출 분류 →
        </Link>
      </p>
      {ctx.confirmDialog}
    </>
  );
}
