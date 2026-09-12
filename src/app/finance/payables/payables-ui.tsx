"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PayLinkRow, PayablesData, PayableSupplier } from "@/lib/recon-data";
import {
  addSupplierAlias,
  autoLinkExact,
  payFromWithdrawal,
  payToSupplier,
  removeSupplierAlias,
  skipWithdrawal,
} from "@/lib/purchase-pay";
import type { SupplierCardInfo } from "@/lib/payables-view";
import { won } from "@/components/fin/money";
import { useConfirm, type ConfirmOpts } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const METHODS = ["계좌이체", "현금", "카드", "기타"];

/* ───────────────────────── 공통 손잡이 (개편 3단계, 2026-09-12 — 조각으로 승격) ─────────────────────────
   PayablesUi 안에 있던 진행 상태·출금→지급 대조·접기·줄 밑 알림을 훅으로 빼서, 기존 화면과
   「이번 주 정리」 흐름(⑥)이 같은 출금 줄(WithdrawalRow)을 쓴다. 동작은 전과 같다. */

export interface PayCtx {
  pending: boolean;
  /** 진행 상태 묶음 — 거래처 카드(지급 확인·별명·손 지급)도 같은 start/setMsg/setError 를 쓴다 */
  start: (fn: () => Promise<void>) => void;
  setMsg: (m: string | null) => void;
  setError: (m: string | null) => void;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
  confirmDialog: ReactNode;
  msg: string | null;
  error: string | null;
  /** 출금 → 거래처로 지급 대조 (확인 시트 → payFromWithdrawal) */
  linkPay: (row: PayLinkRow, supplier: string) => Promise<void>;
  /** 「대조 제외 — 접기」 (확인 시트 → skipWithdrawal) */
  skipRow: (row: PayLinkRow) => Promise<void>;
  /** 출금 → 거래처 직접 선택 (제안이 없거나 다를 때) */
  linkPick: Record<number, string>;
  setLinkPick: (id: number, v: string) => void;
  /** 줄 밑 알림 (거절 이유) */
  rowNote: Record<number, string>;
  /** 거래처별 미지급 잔액 — 0원인 곳은 누르기 전에 알려 준다 */
  remainBySup: Map<string, number>;
}

export function usePayCtx({ remainBySup }: { remainBySup: Map<string, number> }): PayCtx {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm(); // 배치5 — 브라우저 confirm() 대체
  const [linkPick, setLinkPickState] = useState<Record<number, string>>({});
  /* 🔴 결과를 누른 줄 바로 밑에 보여준다 (사장님 제보 2026-08-31 — "지급 클릭 →
     아무일도 안일어남"). 실은 「미지급이 없습니다」 거절이 위쪽 배너에만 떠서 안 보였다. */
  const [rowNote, setRowNote] = useState<Record<number, string>>({});

  const linkPay = async (row: PayLinkRow, supplier: string) => {
    if (
      !(await ask({
        title: `「${supplier}」 ${W.reconPay}할까요?`,
        body: `${row.at} 출금 ${won(row.amount)}원 — 오래된 매입부터 차례로 채웁니다.`,
        confirmLabel: W.reconPay,
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payFromWithdrawal({ cashTxnId: row.id, supplier });
      if (!r.ok) {
        setRowNote((p) => ({ ...p, [row.id]: r.error }));
        return setError(r.error);
      }
      setRowNote((p) => ({ ...p, [row.id]: "" }));
      setMsg(
        `지급 ${won(r.applied)}원 ${W.recon} — ${r.settled}건 완납${r.leftover > 0 ? ` · 출금의 ${won(r.leftover)}원은 ${W.payable}보다 커서 배분 안 됨` : ""}`,
      );
      router.refresh();
    });
  };

  /* ⭐ 「대조 제외 — 접기」 (2026-08-31) — 앱 이전 기간 대금은 대조할 인보이스가 없다.
     되살리기(skipWithdrawal(id,true))는 2단계부터 「최근 한 일」에서. */
  const skipRow = async (row: PayLinkRow) => {
    if (
      !(await ask({
        title: "이 출금을 접을까요?",
        body: `${row.at} ${row.payer} ${won(row.amount)}원 — 앱에 ${W.recon}할 인보이스가 없는 출금(지난달 대금 등)을 목록에서 접습니다.
분류(매입대금)와 손익은 그대로이고, 「${W.activity}」에서 언제든 되돌립니다.`,
        confirmLabel: "접기",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await skipWithdrawal(row.id, false);
      if (!r.ok) return setError(r.error);
      setMsg(`접었습니다 — 「${W.activity}」에서 되돌릴 수 있습니다.`);
      router.refresh();
    });
  };

  const setLinkPick = (id: number, v: string) => setLinkPickState((p) => ({ ...p, [id]: v }));

  return { pending, start, setMsg, setError, ask, confirmDialog, msg, error, linkPay, skipRow, linkPick, setLinkPick, rowNote, remainBySup };
}

/** 안내 띠 — 실패·성공 한 줄 */
export function PayBanner({ ctx }: { ctx: PayCtx }) {
  return (
    <>
      {ctx.error && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {ctx.error}</p>}
      {ctx.msg && <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {ctx.msg}</p>}
    </>
  );
}

/** 출금 한 줄 — 제안 거래처로 지급 / 거래처 검색해서 지급 / 접기. `<li>` 를 그린다.
 *  🔴 거래처 검색 입력은 `<datalist id="pay-supplier-names">` 를 찾는다 — 부르는 화면이 한 번 그려야 한다 */
export function WithdrawalRow({ row, ctx, supplierNames }: { row: PayLinkRow; ctx: PayCtx; supplierNames: string[] }) {
  const { pending, linkPay, skipRow, linkPick, setLinkPick, rowNote, remainBySup } = ctx;
  return (
    <li className="flex flex-wrap items-center justify-between gap-1.5">
      <span className="tabular min-w-0 truncate text-xs">
        {row.at} · {row.payer} · <strong>−{won(row.amount)}원</strong>
      </span>
      {row.suggest ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => linkPay(row, row.suggest!.supplier)}
          className="shrink-0 rounded-lg bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          → {row.suggest.supplier} 지급 (잔액 {won(row.suggest.remain)})
        </button>
      ) : (
        <span className="flex shrink-0 items-center gap-1">
          <input
            value={linkPick[row.id] ?? ""}
            onChange={(e) => setLinkPick(row.id, e.target.value)}
            list="pay-supplier-names"
            placeholder="거래처 검색…"
            className="w-28 rounded-lg border border-slate-300 px-1.5 py-1 text-xs"
          />
          <button
            type="button"
            disabled={
              pending ||
              !supplierNames.includes((linkPick[row.id] ?? "").trim()) ||
              !remainBySup.has((linkPick[row.id] ?? "").trim())
            }
            onClick={() => linkPay(row, (linkPick[row.id] ?? "").trim())}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
          >
            지급
          </button>
        </span>
      )}
      {/* ⭐ 대조할 인보이스가 없는 출금(지난달 대금 등)은 접는다 (2026-08-31) */}
      <button
        type="button"
        disabled={pending}
        onClick={() => skipRow(row)}
        className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-slate-400 underline underline-offset-2 active:bg-slate-100"
        title={`앱에 ${W.recon}할 인보이스가 없으면 접습니다 — ${W.activity}에서 되돌릴 수 있어요`}
      >
        {W.excluded}
      </button>
      {/* 미지급 0원 거래처를 골랐을 때 — 서버까지 안 가고 바로 알려 준다 */}
      {(() => {
        const picked = (linkPick[row.id] ?? "").trim();
        const zero = !row.suggest && supplierNames.includes(picked) && !remainBySup.has(picked);
        const note = rowNote[row.id];
        if (!zero && !note) return null;
        return (
          <p className="w-full rounded-lg bg-amber-50 p-1.5 text-xs text-amber-800">
            {note ||
              `「${picked}」는 지금 ${W.payable}이 0원입니다 — 인보이스가 아직 앱에 안 들어온 ${W.prepaid}이면 입고 뒤에 ${W.recon}하고, 그동안은 「${W.excluded}」로 접어 두세요.`}
          </p>
        );
      })()}
    </li>
  );
}

/** ⭐ 미지급금 장부 — 거래처별 잔액 + 지급 등록 (ERP ⑦, 2026-08-25)
 *   화면 글자는 fin-words 정본(ERP 용어, 2026-09-12): 지급 잡기→지급 대조, 도장 찍기→지급 확인, 예치금→선급금.
 *   되돌리기 표(접어둔 출금·출금에서 대조한 지급·최근 지급)는 「최근 한 일」로 옮겼다.
 *   🔴 개편 3단계(2026-09-12): 출금 줄·손잡이는 위 조각(usePayCtx·WithdrawalRow)으로 — 모양·동작은 전과 같다. */
export function PayablesUi({
  data,
  cards,
  payerOptions,
  links,
  supplierNames,
  cashSummary,
}: {
  data: PayablesData;
  /** ⭐ 리모델링(2026-08-31) — 거래처마다 세 장부(준 돈·계산서·선급금·자동 대조)를 합친 카드 정보 */
  cards: Record<string, SupplierCardInfo>;
  /** 별명 추가할 때 고를 이 달 통장 이름 후보 (검색) */
  payerOptions: string[];
  links: PayLinkRow[];
  supplierNames: string[];
  cashSummary: { ym: string; n: number; sum: number };
}) {
  const router = useRouter();
  const ctx = usePayCtx({ remainBySup: new Map(data.suppliers.map((x) => [x.supplier, x.remain])) });
  const { pending, start, setMsg, setError, ask, confirmDialog } = ctx;
  /** 거래처별 지급 폼 상태 */
  const [form, setForm] = useState<Record<string, { amount: string; method: string; paidOn: string }>>({});

  /* ⚡ 원단위 자동 대조 (리모델링 ②) — 출금이 인보이스(묶음)와 정확히 일치할 때 한 번에 */
  const autoLink = async (supplier: string, e: { cashTxnId: number; day: string; amount: number; invoiceNos: string[] }) => {
    if (
      !(await ask({
        title: `자동으로 ${W.recon}할까요?`,
        body: `${e.day} 출금 ${won(e.amount)}원 = ${supplier} 인보이스 ${e.invoiceNos.length}장 합과 원단위까지 일치합니다.\n(${e.invoiceNos.join(" · ")})`,
        confirmLabel: W.recon,
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await autoLinkExact({ cashTxnId: e.cashTxnId, supplier });
      if (!r.ok) return setError(r.error);
      setMsg(`⚡ ${supplier} 인보이스 ${r.n}장에 ${won(r.amount)}원을 ${W.recon}했습니다.`);
      router.refresh();
    });
  };

  /* ✅ 「계산서로 확인됨 — 지급 확인」 (리모델링 ③, 나이스형; 옛 이름 「도장 찍기」) — 실제 돈은
     계산서↔통장에서 이미 확인됐고, 앱 보조 장부의 잔액만 0 으로 맞춘다.
     🔴 memo 값("장부 도장")은 DB 에 남는 문자열이라 그대로 둔다 — 화면 글자만 바꿈. */
  const stamp = async (s: PayableSupplier, taxOkN: number) => {
    if (
      !(await ask({
        title: `${s.supplier} 장부를 ${W.payConfirm}할까요?`,
        body: `이 거래처의 세금계산서 ${taxOkN}장이 통장 출금으로 이미 확인됐습니다.\n앱 매입 장부의 잔액 ${won(s.remain)}원을 지급 완료로 맞춥니다 (실제 돈은 이미 나간 것).`,
        confirmLabel: W.payConfirm,
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payToSupplier({
        supplier: s.supplier, amount: s.remain, method: "계좌이체",
        paidOn: kstToday(), memo: "세금계산서·통장 확인 완료 — 장부 도장",
      });
      if (!r.ok) return setError(r.error);
      setMsg(`✅ ${s.supplier} ${W.payConfirm} 완료 (${won(r.applied)}원) — 장부를 실제와 맞췄습니다.`);
      router.refresh();
    });
  };

  /* ④ 통장 이름 별명 관리 */
  const [aliasDraft, setAliasDraft] = useState<Record<string, string>>({});
  const aliasAdd = (supplier: string) => {
    const raw = (aliasDraft[supplier] ?? "").trim();
    if (!raw) return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await addSupplierAlias(supplier, raw);
      if (!r.ok) return setError(r.error);
      setAliasDraft((prev) => ({ ...prev, [supplier]: "" }));
      setMsg(`「${raw}」 를 ${supplier} 의 통장 이름으로 기억했습니다.`);
      router.refresh();
    });
  };
  const aliasRemove = (supplier: string, key: string, raw: string) =>
    start(async () => {
      const r = await removeSupplierAlias(supplier, key);
      if (!r.ok) return setError(r.error);
      setMsg(`「${raw}」 별명을 지웠습니다.`);
      router.refresh();
    });

  const getForm = (s: PayableSupplier) =>
    form[s.supplier] ?? { amount: String(s.remain), method: "계좌이체", paidOn: kstToday() };

  const pay = async (s: PayableSupplier) => {
    const f = getForm(s);
    const amount = Number(f.amount.replace(/\D/g, ""));
    if (!amount) return setError("지급 금액을 적어 주세요");
    if (
      !(await ask({
        title: `${s.supplier}에 지급을 넣을까요?`,
        body: `${won(amount)}원 — 오래된 매입부터 차례로 채웁니다.`,
        confirmLabel: "지급 등록",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await payToSupplier({ supplier: s.supplier, amount, method: f.method, paidOn: f.paidOn });
      if (!r.ok) return setError(r.error);
      setMsg(
        `지급 ${won(r.applied)}원 등록 — ${r.settled}건 완납${r.leftover > 0 ? ` · 잔액보다 커서 ${won(r.leftover)}원은 배분 안 됨` : ""}`,
      );
      router.refresh();
    });
  };

  return (
    <>
      <PayBanner ctx={ctx} />

      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4 text-center">
        <p className="text-xs text-slate-500">{W.payable} (잔액 전체)</p>
        <p className="tabular mt-1 text-xl font-bold text-red-600">{won(data.totalRemain)}원</p>
      </section>

      {/* ⭐ 정본 안내 (재설계 2026-08-25) — 계산서 대조의 단일 답변처는 「계산서 대조」 뷰 */}
      <section className="mt-4 rounded-card border-2 border-brand-500 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm">
            <span className="font-semibold text-brand-700">세금계산서 기준 (정본)</span> —{" "}
            {Number(cashSummary.ym.slice(5, 7))}월 매입 계산서 중 출금 {W.open}{" "}
            <strong className="tabular">
              {cashSummary.n}건 · {won(cashSummary.sum)}원
            </strong>
          </p>
          <Link
            href={`/finance/tax?view=money&ym=${cashSummary.ym}&direction=매입`}
            className="shrink-0 rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700"
          >
            {W.reconTax} 화면 →
          </Link>
        </div>
      </section>

      {/* 🔴 감사 P2 — 출금에서 지급 대조: 이미 준 돈을 장부가 알게 하는 고리 */}
      {links.length > 0 && (
        <section className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4">
          <h2 className="font-semibold text-sky-900">출금에서 {W.reconPay} ({links.length}건)</h2>
          <p className="mt-1 text-xs text-sky-800">
            매입대금으로 분류된 통장 출금 중 아직 지급 기록과 {W.recon} 안 된 것 — 한 번씩 {W.recon}해 주면
            {W.payable} 잔액이 실제와 같아집니다
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {links.map((row) => (
              <WithdrawalRow key={row.id} row={row} ctx={ctx} supplierNames={supplierNames} />
            ))}
          </ul>
        </section>
      )}

      {/* 🔴 2단계(2026-09-12): 「접어둔 출금 N건 — 되살리기」 접힌 표는 「최근 한 일」로(맨 아래 링크). */}

      {data.suppliers.length === 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          미지급 잔액이 없습니다 🎉
        </section>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {data.suppliers.map((s) => {
          const f = getForm(s);
          return (
            <li key={s.supplier} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/finance/party/${encodeURIComponent(`S:${s.supplier}`)}`}
                  className="font-semibold underline-offset-2 hover:underline"
                  title="이 거래처의 원장 보기"
                >
                  {s.supplier} <span className="text-xs font-normal text-slate-400">원장 →</span>
                </Link>
                <span className="tabular font-bold text-red-600">{won(s.remain)}원</span>
              </div>
              <p className="tabular mt-0.5 text-xs text-slate-500">
                미지급 {s.invoices.length}건{s.oldestD ? ` · 가장 오래된 것 ${s.oldestD}` : ""}
              </p>

              {/* ⭐ 리모델링 ①③ — 세 장부 한눈에 + 성격 배지 (2026-08-31) */}
              {(() => {
                const info = cards[s.supplier];
                if (!info) return null;
                const gaveNothing = info.bankN === 0 && info.cardN === 0 && info.taxN === 0;
                return (
                  <div className="mt-1.5 space-y-1.5">
                    <p className="tabular text-xs text-slate-500">
                      이 달 준 돈: 통장 {info.bankN}건 {won(info.bankSum)} · 카드 {info.cardN}건 {won(info.cardSum)}
                      {info.taxN > 0 && ` · 계산서 ${info.taxN}장 ${won(info.taxSum)}`}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {gaveNothing && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          결제 예정 — 이 달 준 기록 없음 (정상)
                        </span>
                      )}
                      {info.deposit > 0 && (
                        <span className="tabular rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                          {W.prepaid} {won(info.deposit)}원 남음
                        </span>
                      )}
                      {info.taxOkN > 0 && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                          계산서 {info.taxOkN}장 통장과 {W.done}
                        </span>
                      )}
                    </div>
                    {info.exact.map((e) => (
                      <button
                        key={e.cashTxnId}
                        type="button"
                        disabled={pending}
                        onClick={() => autoLink(s.supplier, e)}
                        className="tabular block w-full rounded-lg bg-sky-700 px-2.5 py-1.5 text-left text-xs font-semibold text-white disabled:opacity-40"
                      >
                        ⚡ {e.day} 출금 {won(e.amount)}원 = 인보이스 {e.invoiceNos.length}장 — 자동 {W.recon}
                      </button>
                    ))}
                    {/* 🔴 지급 확인은 대조 완료 계산서 합이 잔액을 덮을 때만 — 소액 계산서 몇 장으로
                        큰 잔액을 확인 처리하면 안 준 돈이 사라진다 (강남세차장 사례로 발견) */}
                    {info.taxOkN > 0 && info.taxOkSum >= s.remain && info.exact.length === 0 && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => stamp(s, info.taxOkN)}
                        className="tabular block w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-left text-xs font-semibold text-emerald-800 disabled:opacity-40"
                      >
                        ✅ 이미 준 돈으로 확인됨 — 잔액 {won(s.remain)}원 {W.payConfirm}
                      </button>
                    )}
                  </div>
                );
              })()}

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 underline">매입별 잔액 보기</summary>
                <ul className="tabular mt-1 space-y-0.5 text-xs text-slate-600">
                  {s.invoices.map((inv) => (
                    <li key={inv.invoiceId} className="flex justify-between">
                      <span className="min-w-0 truncate">
                        {inv.d?.slice(5) ?? "?"} · {inv.invoiceNo}
                      </span>
                      <span>
                        {inv.paid > 0 && <span className="text-slate-400">{won(inv.paid)} 지급 · </span>}
                        잔액 {won(inv.remain)}원
                      </span>
                    </li>
                  ))}
                </ul>
              </details>

              {/* ④ 통장 이름 별명 — 여기서 직접 관리 (맨날 알려주지 않아도 되게) */}
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-slate-400 underline">
                  통장 이름 짝 {cards[s.supplier]?.aliases.length ?? 0}개
                </summary>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {(cards[s.supplier]?.aliases ?? []).map((a) => (
                    <li key={a.key} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{a.raw}</span>
                      <button type="button" disabled={pending} onClick={() => aliasRemove(s.supplier, a.key, a.raw)}
                        className="shrink-0 text-slate-400" aria-label="별명 지우기">✕</button>
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    value={aliasDraft[s.supplier] ?? ""}
                    onChange={(e) => setAliasDraft((p) => ({ ...p, [s.supplier]: e.target.value }))}
                    list="bank-payer-names"
                    placeholder="통장에 찍히는 이름 검색"
                    className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button type="button" disabled={pending || !(aliasDraft[s.supplier] ?? "").trim()}
                    onClick={() => aliasAdd(s.supplier)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">
                    기억
                  </button>
                </div>
              </details>

              {/* 손으로 지급 적기 — 통장에 안 찍힌 지급(현금·상계 등)용. 이름을 밝히고 접어 둔다
                  (사장님 질문 2026-08-31 "지급 등록은 무슨 버튼인거지?") */}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 underline">손으로 지급 적기</summary>
                <p className="mt-1 text-xs text-slate-400">
                  통장에 안 찍힌 지급(현금·{W.offset} 등)을 직접 기록합니다. 통장으로 보낸 돈은 위
                  「출금에서 {W.reconPay}」·⚡ 자동 {W.recon}로 {W.recon}하는 것이 정확합니다.
                </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  value={f.amount}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, amount: e.target.value.replace(/[^\d,]/g, "") } }))}
                  inputMode="numeric"
                  className="tabular w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
                  aria-label="지급 금액"
                />
                <select
                  value={f.method}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, method: e.target.value } }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={f.paidOn}
                  onChange={(e) => setForm((p) => ({ ...p, [s.supplier]: { ...f, paidOn: e.target.value } }))}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  aria-label="지급일"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pay(s)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  지급 적기
                </button>
              </div>
              </details>
            </li>
          );
        })}
      </ul>

      {/* 선급금만 남은 거래처 — 잔액은 0이지만 미리 넣어둔 돈이 있다 (딜러타이어형) */}
      {Object.entries(cards).filter(([sup, i]) => i.deposit > 0 && !data.suppliers.some((x) => x.supplier === sup))
        .length > 0 && (
        <section className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-3 text-xs text-sky-900">
          <p className="font-semibold">{W.prepaid}이 남아 있는 거래처</p>
          <ul className="tabular mt-1 space-y-0.5">
            {Object.entries(cards)
              .filter(([sup, i]) => i.deposit > 0 && !data.suppliers.some((x) => x.supplier === sup))
              .map(([sup, i]) => (
                <li key={sup}>
                  {sup} — {won(i.deposit)}원 (다음 인보이스가 들어오면 「{W.reconPay}」에서 {W.recon}합니다)
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* 별명 추가 검색 후보 — 이 달 통장 출금 상대 (2026-08-31) */}
      <datalist id="bank-payer-names">
        {payerOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <datalist id="pay-supplier-names">
        {supplierNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* ⭐ 개편 2단계(2026-09-12) — 「출금에서 대조한 지급」·「최근 지급 기록」·「접어둔 출금」의
          되돌리기 표 3개는 「최근 한 일」 한 곳으로(결정 f). 여기엔 링크 한 줄만. */}
      <p className="mt-4 text-xs text-slate-400">
        잘못 {W.recon}한 지급·잘못 접은 출금은{" "}
        <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
      </p>
      {confirmDialog}
    </>
  );
}
