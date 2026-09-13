"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import type { PayLinkRow, PayableSupplier } from "@/lib/recon-data";
import type { WeeklyPayableStep } from "@/lib/weekly-types";
import { payFromWithdrawal, payToSupplier, skipWithdrawal } from "@/lib/purchase-pay";
import { LearnCheck } from "@/components/fin/learn-check";
import { won } from "@/components/fin/money";
import { useConfirm, type ConfirmOpts } from "@/components/ui/confirm";
import { W } from "@/lib/fin-words";

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const METHODS = ["계좌이체", "현금", "카드", "기타"];

/* ───────────────────────── 공통 손잡이 (개편 3단계, 2026-09-12 — 조각으로 승격) ─────────────────────────
   옛 PayablesUi 안에 있던 진행 상태·출금→지급 대조·접기·줄 밑 알림을 훅으로 빼서, 기존 화면과
   「이번 주 정리」 흐름(⑥)이 같은 출금 줄(WithdrawalRow)을 쓴다. 동작은 전과 같다.
   🔴 개편 5단계(2026-09-13): 기존 화면도 흐름 조각(PayablesFlow)을 그리게 되어 PayablesUi 는 지웠다 —
      거래처 카드에서 남길 것만 SupplierCards(맨 아래)로. */

export interface PayCtx {
  pending: boolean;
  /** 진행 상태 묶음 — 거래처 카드(SupplierCards: 지급 확인·손 지급)도 같은 start/setMsg/setError 를 쓴다 */
  start: (fn: () => Promise<void>) => void;
  setMsg: (m: string | null) => void;
  setError: (m: string | null) => void;
  ask: (opts: ConfirmOpts) => Promise<boolean>;
  confirmDialog: ReactNode;
  msg: string | null;
  error: string | null;
  /**
   * 출금 → 거래처로 지급 대조 (확인 시트 → payFromWithdrawal)
   * ⭐ learn = 「다음부터 자동으로」(개편 4단계, 2026-09-12) — 출금 줄의 체크칸 값.
   *    안 넘기면 켜진 것으로 본다(기본 켜짐 — 지금까지의 동작).
   */
  linkPay: (row: PayLinkRow, supplier: string, learn?: boolean) => Promise<void>;
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

  const linkPay = async (row: PayLinkRow, supplier: string, learn = true) => {
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
      const r = await payFromWithdrawal({ cashTxnId: row.id, supplier }, { learn });
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
  /* ⭐ 「다음부터 자동으로」 (개편 4단계, 2026-09-12 — 결정 7, 기본 켜짐) — 이 출금 줄의 지급 대조에만 걸린다 */
  const [learn, setLearn] = useState(true);
  return (
    <li className="flex flex-wrap items-center justify-between gap-1.5">
      <span className="tabular min-w-0 truncate text-xs">
        {row.at} · {row.payer} · <strong>−{won(row.amount)}원</strong>
      </span>
      {row.suggest ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => linkPay(row, row.suggest!.supplier, learn)}
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
            onClick={() => linkPay(row, (linkPick[row.id] ?? "").trim(), learn)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
          >
            지급
          </button>
        </span>
      )}
      {/* ⭐ 체크칸 — 지급 단추와 같은 줄 (개편 4단계) */}
      <LearnCheck value={learn} onChange={setLearn} disabled={pending} className="shrink-0" />
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

/** ⭐ 거래처 카드 — 「거래처별 자세히」 접힘 안 (개편 5단계, 2026-09-13; 옛 PayablesUi 의 거래처 부분)
 *   화면 글자는 fin-words 정본(ERP 용어, 2026-09-12): 도장 찍기→지급 확인, 예치금→선급금.
 *   남긴 것: 원장 링크·잔액·매입별 잔액·✅지급 확인·손 지급 폼·선급금 남은 거래처.
 *   🔴 뺀 것(사장님 결정): ⚡낱건 자동 대조(흐름의 「짝 확실」 층이 한 번에 한다)·통장 이름 별명 관리
 *      (addSupplierAlias/removeSupplierAlias 액션은 남아 있다 — 규칙 화면 몫)·계산서 안내 박스·큰 잔액 박스
 *      (PayablesFlow 머리가 보여 준다)·되돌리기 표(「최근 한 일」). 액션은 payToSupplier 하나뿐.
 *   진행 상태·확인 시트는 PayablesFlow 의 ctx 를 같이 쓴다(배너·confirmDialog 도 거기 것). */
export function SupplierCards({ step, ctx }: { step: WeeklyPayableStep; ctx: PayCtx }) {
  const router = useRouter();
  const { pending, start, setMsg, setError, ask } = ctx;
  const { suppliers, cardsLite } = step;
  /** 거래처별 지급 폼 상태 */
  const [form, setForm] = useState<Record<string, { amount: string; method: string; paidOn: string }>>({});
  /** 흐름 「짝 확실」에 든 거래처 — 옛 카드의 「⚡정확 후보 없음」 조건(info.exact.length === 0)과 같은 뜻 */
  const hasSure = (supplier: string) => step.sure.some((e) => e.supplier === supplier);

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

  /* 선급금만 남은 거래처 — 잔액은 0이지만 미리 넣어둔 돈이 있다 (딜러타이어형) */
  const prepaidOnly = Object.entries(cardsLite).filter(
    ([sup, i]) => i.deposit > 0 && !suppliers.some((x) => x.supplier === sup),
  );

  return (
    <>
      <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        {suppliers.map((s) => {
          const f = getForm(s);
          const info = cardsLite[s.supplier];
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

              {info && (
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex flex-wrap gap-1">
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
                  {/* 🔴 지급 확인은 대조 완료 계산서 합이 잔액을 덮을 때만 — 소액 계산서 몇 장으로
                      큰 잔액을 확인 처리하면 안 준 돈이 사라진다 (강남세차장 사례로 발견).
                      「짝 확실」 출금이 있는 거래처는 그쪽이 먼저다(옛 exact.length === 0 조건). */}
                  {info.taxOkN > 0 && info.taxOkSum >= s.remain && !hasSure(s.supplier) && (
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
              )}

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

              {/* 손으로 지급 적기 — 통장에 안 찍힌 지급(현금·상계 등)용. 이름을 밝히고 접어 둔다
                  (사장님 질문 2026-08-31 "지급 등록은 무슨 버튼인거지?") */}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-500 underline">손으로 지급 적기</summary>
                <p className="mt-1 text-xs text-slate-400">
                  통장에 안 찍힌 지급(현금·{W.offset} 등)을 직접 기록합니다. 통장으로 보낸 돈은 위
                  「{W.tierSure}」·「{W.tierCheck}」에서 {W.recon}하는 것이 정확합니다.
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

      {prepaidOnly.length > 0 && (
        <section className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-3 text-xs text-sky-900">
          <p className="font-semibold">{W.prepaid}이 남아 있는 거래처</p>
          <ul className="tabular mt-1 space-y-0.5">
            {prepaidOnly.map(([sup, i]) => (
              <li key={sup}>
                {sup} — {won(i.deposit)}원 (다음 인보이스가 들어오면 「{W.reconPay}」에서 {W.recon}합니다)
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
