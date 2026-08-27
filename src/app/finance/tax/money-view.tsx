"use client";

/**
 * ⭐ 돈 확인 뷰 (tax 재설계 배치2, 사장님 요구 2026-08-25)
 *
 *   "매입·매출 계산서에 대응해 실제로 출금·입금 됐는지" — 의 단일 답변처.
 *   진행률(bank_ok 기준) + 돈 미확인 계산서 목록(금액 큰 순) + 통장 잇기.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { TaxCashData } from "@/lib/tax-recon";
import {
  closeTaxShortfall,
  confirmMonthlyParty,
  confirmSureTax,
  confirmTaxToBank,
  confirmTaxToBanks,
  confirmBankToTaxes,
  undoMonthlyParty,
  undoTaxMatch,
} from "@/lib/recon";
import { useConfirm } from "@/components/ui/confirm";
import { won } from "@/components/fin/money";
import { BankSearch, MultiPickBar, PickList, type Picked, type PickItem } from "./link-parts";

export interface RecentBankRow {
  id: number;
  d: string;
  direction: string;
  name: string;
  total: number;
}

export function MoneyView({ data, recentBank }: { data: TaxCashData; recentBank: RecentBankRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();
  const isIn = data.direction === "매출";
  /** 골라서 잇기 — 계산서 id → (통장 줄 id → 남은 금액) */
  const [sel, setSel] = useState<Record<number, Picked>>({});
  const toggle = (invId: number, it: PickItem) =>
    setSel((p) => {
      const cur = { ...(p[invId] ?? {}) };
      const k = Number(it.key);
      if (k in cur) delete cur[k];
      else cur[k] = it.amount ?? 0;
      return { ...p, [invId]: cur };
    });
  const comboMsg = (r: { applied: number; remaining: number; shortfall: number; absorbed: number; settled: number }) =>
    `${r.applied}줄을 합쳐 이었습니다` +
    (r.absorbed > 0 ? ` — 통장에 남은 ${won(r.absorbed)}원은 수수료·반올림으로 정리했습니다` : "") +
    (r.settled > 0 ? ` — 계산서에 모자란 ${won(r.settled)}원은 차액으로 정리했습니다` : "") +
    (r.shortfall > 0 ? ` — 계산서에 ${won(r.shortfall)}원이 남았습니다 (더 이어 잇거나 「확인 끝」)` : "") +
    (r.remaining > 0 ? ` — 통장 줄에 ${won(r.remaining)}원이 남았습니다` : "") +
    (r.absorbed === 0 && r.settled === 0 && r.shortfall === 0 && r.remaining === 0 ? " — 금액이 정확히 맞습니다." : ".");
  const linkPicked = (invId: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const ids = Object.keys(sel[invId] ?? {}).map(Number);
      const r = await confirmTaxToBanks(invId, ids);
      if (!r.ok) return setError(r.error);
      setSel((p) => ({ ...p, [invId]: {} }));
      setMsg(comboMsg(r));
      router.refresh();
    });

  const link = (invId: number, cashId: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmTaxToBank(invId, cashId);
      if (!r.ok) return setError(r.error);
      setMsg(
        // 상계 = 반대 방향 연결 (정산 입금에서 수수료 차감 · 매입과 상계)
        (r.netted ? "반대 방향 줄로 확인했습니다 — 수수료를 떼고 주고받은 건입니다. " : "") +
          (r.shortfall > 0
            ? `계산서에 ${won(r.shortfall)}원이 남았습니다 — 다른 ${isIn ? "입금" : "출금"}을 이어서 잇거나, 수수료·적립 차액이면 「확인 끝」을 누르세요`
            : r.remaining > 0
              ? `확인했습니다 — 이 통장 줄에 ${won(r.remaining)}원이 남았습니다 (다른 계산서 몫이면 이어서 확인하세요)`
              : "확인했습니다 — 금액이 정확히 맞습니다."),
      );
      router.refresh();
    });

  /* ⭐ 통장 한 줄에 계산서 N장 (타이어프로 속초점 케이스) */
  const linkBundle = (cashId: number, invIds: number[]) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmBankToTaxes(cashId, invIds);
      if (!r.ok) return setError(r.error);
      setMsg(`계산서 ${r.applied}장을 통장 줄 하나에 이었습니다 — 금액이 정확히 맞습니다.`);
      router.refresh();
    });

  /* ⭐ 합이 딱 맞는 여러 줄을 한꺼번에 (위즈오토 케이스) */
  const linkCombo = (invId: number, ids: number[]) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmTaxToBanks(invId, ids);
      if (!r.ok) return setError(r.error);
      setMsg(comboMsg(r));
      router.refresh();
    });

  const settle = async (invId: number, remain: number) => {
    if (
      !(await ask({
        title: "남은 차액을 확인 끝으로 정리할까요?",
        body: `남은 ${won(remain)}원을 수수료·적립·에누리 차액으로 보고 이 계산서의 돈 확인을 끝냅니다.\n(잘못 정리했으면 「통장 연결 되돌리기」로 함께 풀립니다)`,
        confirmLabel: "확인 끝",
      }))
    )
      return;
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await closeTaxShortfall(invId);
      if (!r.ok) return setError(r.error);
      setMsg(`차액 ${won(r.settled)}원을 정리하고 확인을 끝냈습니다.`);
      router.refresh();
    });
  };

  /* ⭐ 월정산 상대 — 계산서 1장 ↔ 출금 1건이 대응하지 않는 거래처(미쉐린형).
     그 달 계산서 합과 지급 합을 견주고 「맞음」 한 번으로 끝낸다. */
  const confirmMonth = (bizNo: string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmMonthlyParty(bizNo, data.ym, data.direction);
      if (!r.ok) return setError(r.error);
      setMsg(`${r.applied}건을 이 달 정산으로 확인했습니다.`);
      router.refresh();
    });

  const undoMonth = (bizNo: string) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await undoMonthlyParty(bizNo, data.ym, data.direction);
      if (!r.ok) return setError(r.error);
      setMsg(`${r.reverted}건을 되돌렸습니다.`);
      router.refresh();
    });

  const undoBank = (invId: number) =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await undoTaxMatch(invId, "통장");
      if (!r.ok) return setError(r.error);
      setMsg("통장 연결을 되돌렸습니다 — 목록으로 돌아갑니다.");
      router.refresh();
    });

  const pct = data.total.n > 0 ? Math.round((data.bankOk.n / data.total.n) * 100) : 0;
  /* ⭐ 짝이 확실한 것 — 정확 일치 + ★ + 정확 후보 하나뿐, 또는 정확 묶음 (서버가 같은 규칙으로 재계산) */
  const sureN = data.rows.filter((r) => {
    if (r.isFix) return true; // 원본이 하나뿐이면 서버가 상쇄한다
    if (r.fixFirst) return false;
    const remain = r.total - r.bankCovered;
    const exact = r.autoBank.filter((b) => b.amount === remain);
    if (exact.length === 1 && exact[0].known) return true;
    if (exact.length === 0 && !!r.bankCombo && r.bankCombo.diff === 0) return true;
    // 이체 수수료 차이 — 허용 오차 안 ★ 후보가 딱 하나 (서버 sureTaxPicks 와 같은 규칙)
    const tol = Math.max(1000, Math.round(remain * 0.001));
    return exact.length === 0 && !r.bankCombo &&
      r.autoBank.filter((b) => b.known && Math.abs(b.amount - remain) <= tol).length === 1;
  }).length;
  const linkSure = () =>
    start(async () => {
      setMsg(null);
      setError(null);
      const r = await confirmSureTax(data.ym, data.direction);
      if (!r.ok) return setError(r.error);
      setMsg(`짝이 확실한 ${r.applied}건을 이었습니다${r.failed > 0 ? ` · ${r.failed}건은 실패` : ""}.`);
      router.refresh();
    });
  const base = `/finance/tax?view=money&ym=${data.ym}`;
  const seg = (on: boolean) =>
    `flex-1 rounded-full py-2.5 text-center text-sm font-semibold transition-colors ${
      on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
    }`;

  return (
    <>
      {/* 매입/매출 토글 — 방향을 섞지 않는다 (직관성) */}
      <div className="mt-3 flex gap-1 rounded-full bg-slate-100 p-1">
        <Link href={`${base}&direction=매입`} className={seg(!isIn)}>
          매입 — 돈이 나갔나 (출금)
        </Link>
        <Link href={`${base}&direction=매출`} className={seg(isIn)}>
          매출 — 돈이 들어왔나 (입금)
        </Link>
      </div>

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠ {error}</p>}
      {msg && <p className="mt-2 rounded-lg bg-brand-50 p-2 text-sm text-brand-700">✓ {msg}</p>}

      {/* 진행률 — 사장님 질문의 답 */}
      <section className="mt-3 rounded-card border-2 border-brand-500 bg-white p-4">
        <p className="tabular text-sm">
          {Number(data.ym.slice(5, 7))}월 {data.direction} 계산서{" "}
          <strong className="text-lg">
            {data.total.n}건 중 {data.bankOk.n}건
          </strong>{" "}
          {isIn ? "입금" : "출금"} 확인됨
        </p>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {sureN > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={linkSure}
            className="mt-2 rounded-control bg-brand-600 px-3 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            ✔ 짝이 확실한 {sureN}건 모두 잇기
          </button>
        )}
        {sureN > 0 && (
          <p className="mt-1 text-[11px] text-slate-500">정확 일치 ★ · ★ 묶음 · 수수료 차이(1,000원 안) · 원본 하나뿐인 마이너스 상쇄</p>
        )}
        <p className="tabular mt-1.5 text-xs text-slate-500">
          돈 확인할 것 {data.open.n}건 · {won(data.bankOk.sum)}원 확인 / 전체 {won(data.total.sum)}원
          {data.ignoredN > 0 && ` · 정리(무시) ${data.ignoredN}건은 셈에서 뺐습니다`}
        </p>
      </section>

      {/* ⭐ 월정산 거래처 — 잔액으로 본다 (사장님 승인 2026-08-25) */}
      {data.monthly.length > 0 && (
        <section className="mt-4">
          <h2 className="text-[15px] font-semibold">월정산 거래처 — 잔액으로 봅니다</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            계산서는 월말에 한 장, 결제는 수시로 나눠 하는 곳입니다 — 한 건씩 맞출 수 없으니
            이 달 합계와 잔액만 보시면 됩니다.
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
            {data.monthly.map((m) => (
              <li key={m.bizNo} className="rounded-card border border-slate-200 bg-white p-3 shadow-card">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{m.name}</span>
                  {m.confirmed ? (
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      이 달 확인됨
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                      확인 전
                    </span>
                  )}
                </div>
                <dl className="tabular mt-2 space-y-0.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">이 달 계산서 ({m.invN}건)</dt>
                    <dd className="font-medium">{won(m.invSum)}원</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">이 달 {isIn ? "입금" : "지급"} ({m.paidN}건)</dt>
                    <dd className="font-medium">{won(m.paidSum)}원</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1">
                    <dt className="font-medium">{isIn ? "아직 못 받은 돈" : "아직 안 준 돈"} (누적)</dt>
                    <dd className={`font-bold ${m.balance > 0 ? "text-red-600" : "text-brand-700"}`}>
                      {won(m.balance)}원
                    </dd>
                  </div>
                </dl>
                {m.balance < 0 && (
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">
                    − 는 통장 자료 시작(25-01) 이전 이월이 반영되지 않아 생기는 값일 수
                    있습니다 — 정확한 흐름은 원장에서 확인하세요
                  </p>
                )}
                {!m.confirmed && m.invN > 0 && (
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                    이 달 지급이 계산서와 비슷하면 [이 달 맞음]을 누르세요 — 정확한 잔액 흐름은 원장에서 봅니다
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Link
                    href={`/finance/party/${encodeURIComponent(`B:${m.bizNo}`)}?ym=${data.ym}`}
                    className="text-xs text-slate-500 underline underline-offset-2"
                  >
                    원장 보기 →
                  </Link>
                  {m.confirmed ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => undoMonth(m.bizNo)}
                      className="text-xs text-slate-400 underline disabled:opacity-40"
                    >
                      확인 되돌리기
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending || m.invN === 0}
                      onClick={() => confirmMonth(m.bizNo)}
                      className="rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                    >
                      이 달 맞음 — 확인
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 돈 미확인 목록 — 금액 큰 순 */}
      {data.rows.length === 0 ? (
        <section className="mt-4 rounded-card border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.total.n === 0 && data.ignoredN > 0 ? (
            <>
              이 달 {data.direction} 계산서 {data.ignoredN}건은 전부 「정리(무시)」 상태입니다 — 돈
              확인이 필요하면{" "}
              <Link href={`/finance/tax?view=sort&ym=${data.ym}&direction=${data.direction}`} className="underline">
                계산서 정리
              </Link>
              에서 되살리세요
            </>
          ) : data.total.n === 0 ? (
            <>이 달 {data.direction} 계산서가 없습니다</>
          ) : data.monthly.length > 0 ? (
            <>한 건씩 맞출 계산서는 없습니다 — 위 월정산 거래처만 확인하시면 됩니다</>
          ) : (
            <>이 달 {data.direction} 계산서는 전부 돈이 확인됐습니다 🎉</>
          )}
        </section>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
          {data.rows.map((r) => (
            <li key={r.id} className="rounded-card border border-slate-200 bg-white p-3 shadow-card">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular min-w-0 truncate text-sm">
                  <span className="text-xs text-slate-400">{r.d}</span>{" "}
                  <span className="font-medium">{r.name}</span>
                </span>
                <span className="tabular shrink-0 font-bold">{won(r.total)}원</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {r.isFix ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                    마이너스(수정) 계산서
                  </span>
                ) : r.fixFirst ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                    상쇄할 수정 계산서 있음
                  </span>
                ) : r.bankCovered > 0 ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                    일부 확인 · 남은 {won(r.total - r.bankCovered)}원
                  </span>
                ) : r.appLinked ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    앱 기록 있음 · 돈 미확인
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                    미확인
                  </span>
                )}
                {r.bankCovered > 0 && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => settle(r.id, r.total - r.bankCovered)}
                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-600 active:bg-slate-100 disabled:opacity-40"
                  >
                    남은 건 수수료·적립 — 확인 끝
                  </button>
                )}
              </div>
              {/* 🔴 2025 감사 F4: 수정 계산서는 통장이 아니라 원본과 상쇄 — 정리 뷰로 보낸다 */}
              {r.fixFirst && (
                <p className="mt-1.5 rounded-control bg-rose-50 p-2 text-xs text-rose-900">
                  같은 상대의 마이너스(수정) 계산서가 이 금액을 상쇄합니다 — 통장을 찾기 전에 먼저 정리하세요:{" "}
                  <Link href={`/finance/tax?view=sort&ym=${data.ym}&direction=${data.direction}`} className="font-semibold underline">
                    계산서 정리로 →
                  </Link>
                </p>
              )}
              {r.isFix && (
                <p className="mt-1.5 rounded-control bg-rose-50 p-2 text-xs text-rose-900">
                  통장으로는 끝낼 수 없습니다 — 같은 상대의 원본 계산서와 상쇄해 정리하세요:{" "}
                  <Link href={`/finance/tax?view=sort&ym=${data.ym}&direction=${data.direction}`} className="font-semibold underline">
                    계산서 정리로 →
                  </Link>
                </p>
              )}
              {r.bankBundle && (
                <div className="mt-1.5 rounded-control bg-brand-50 p-2 text-xs">
                  <p className="font-semibold text-brand-700">
                    ✔ {isIn ? "입금" : "출금"} 한 줄({won(r.bankBundle.total)}원)이 이 상대 계산서 {r.bankBundle.invoiceIds.length}장 합과
                    정확히 맞습니다 — {r.bankBundle.parts.join(" + ")}
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => linkBundle(r.bankBundle!.cashId, r.bankBundle!.invoiceIds)}
                    className="mt-1.5 rounded-control bg-brand-600 px-3 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                  >
                    이 {isIn ? "입금" : "출금"}으로 {r.bankBundle.invoiceIds.length}장 한꺼번에 잇기
                  </button>
                </div>
              )}
              {r.bankCombo && (
                <div className="mt-1.5 rounded-control bg-brand-50 p-2 text-xs">
                  <p className="font-semibold text-brand-700">
                    ✔ {isIn ? "입금" : "출금"} {r.bankCombo.ids.length}건을 합치면 {won(r.bankCombo.total)}원 —{" "}
                    {r.bankCombo.diff === 0
                      ? "정확히 맞습니다"
                      : r.bankCombo.diff > 0
                        ? `계산서보다 ${won(r.bankCombo.diff)}원 많음 (수수료·반올림 — 잔돈은 자동 정리)`
                        : `계산서보다 ${won(-r.bankCombo.diff)}원 모자람 (차액은 자동 정리)`}
                  </p>
                  <ul className="mt-0.5 space-y-0.5 text-slate-600">
                    {r.bankCombo.labels.map((l, i) => (
                      <li key={i}>· {l}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => linkCombo(r.id, r.bankCombo!.ids)}
                    className="mt-1.5 rounded-control bg-brand-600 px-3 py-1.5 font-semibold text-white active:bg-brand-700 disabled:opacity-40"
                  >
                    {r.bankCombo.ids.length}건 한꺼번에 잇기
                  </button>
                </div>
              )}
              {!r.isFix && !r.fixFirst && (
                <MultiPickBar
                  picked={sel[r.id] ?? {}}
                  target={r.total - r.bankCovered}
                  pending={pending}
                  onLink={() => linkPicked(r.id)}
                  onClear={() => setSel((p) => ({ ...p, [r.id]: {} }))}
                />
              )}
              {r.autoBank.length > 0 && (
                <PickList
                  hint={
                    r.autoBank.some((b) => b.known)
                      ? `이 상대의 ${isIn ? "입금" : "출금"} — 맞는 것을 고르거나, 여러 줄이면 체크해서 한 번에:`
                      : `금액만 같은 ${isIn ? "입금" : "출금"} — 상대가 맞는지 꼭 확인하세요:`
                  }
                  pending={pending}
                  strong={r.autoBank.some((b) => b.known)}
                  items={r.autoBank.map((b) => ({
                    key: b.id,
                    label: b.label,
                    amount: b.amount,
                    onPick: () => link(r.id, b.id),
                  }))}
                  buttonLabel={isIn ? "이 입금과 잇기" : "이 출금과 잇기"}
                  picked={sel[r.id] ?? {}}
                  onToggle={(it) => toggle(r.id, it)}
                />
              )}
              {r.isFix || r.fixFirst ? null : r.autoBank.length > 0 ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-slate-500 underline underline-offset-2">
                    통장에서 직접 찾기 ▾
                  </summary>
                  <div className="mt-1">
                    <BankSearch
                      direction={data.direction}
                      pending={pending}
                      onPick={(id) => link(r.id, id)}
                      anchor={r.writeDate}
                      picked={sel[r.id] ?? {}}
                      onToggle={(it) => toggle(r.id, it)}
                    />
                  </div>
                </details>
              ) : (
                <div className="mt-1.5">
                  <BankSearch
                    direction={data.direction}
                    pending={pending}
                    onPick={(id) => link(r.id, id)}
                    anchor={r.writeDate}
                    picked={sel[r.id] ?? {}}
                    onToggle={(it) => toggle(r.id, it)}
                  />
                  {!r.bankCombo && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      이 상대와 한 번 이어 두면 다음부터 후보·묶음 추천이 자동으로 켜집니다
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.moreN > 0 && (
        <p className="tabular mt-2 text-xs text-slate-400">
          금액 작은 것 {data.moreN}건이 더 있습니다 — 위 건들을 확인하면 이어서 나옵니다
        </p>
      )}

      {/* 최근 통장 연결 — 잘못 이었으면 통장 연결만 되돌리기 */}
      {recentBank.length > 0 && (
        <details className="mt-4 rounded-card border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            최근 돈 확인 {recentBank.length}건 — 잘못 이었으면 여기서 되돌리기
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {recentBank.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="tabular min-w-0 truncate text-xs">
                  {r.d} {r.direction} · {r.name} · {won(r.total)}원
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => undoBank(r.id)}
                  className="shrink-0 text-xs text-slate-400 underline"
                >
                  통장 연결 되돌리기
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-xs text-slate-400">
        카드·현금으로 받은 판매 대금은 통장에 계산서 단위로 찍히지 않아 여기서 확인되지 않습니다 —
        카드는 <Link href={`/finance/card?ym=${data.ym}`} className="underline">카드 매출 맞추기</Link>에서 따로 맞춥니다. 상대 유형 정리·앱 기록 잇기는 「계산서 정리」 뷰에서.
      </p>
      {confirmDialog}
    </>
  );
}
