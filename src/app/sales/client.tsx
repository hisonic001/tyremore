"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelSale, fulfillReservation, updateSaleHead } from "@/lib/sale-edit";
import Link from "@/lib/link";
import type { SaleRow } from "@/lib/sale-history";
import { EXCLUSIVE, SPLITTABLE, splitLabel } from "@/lib/payments";
import { signedStr, showSigned } from "@/lib/signed-input";
import { CollectionPanel } from "./collections";
import { AddLine, EditableLine } from "./line-edit";
import { ReassignPanel } from "./reassign";

const won = (n: number) => n.toLocaleString("ko-KR");
/** ⭐ 혼합은 이제 직접 고르지 않는다 — 수단을 2개 이상 고르면 자동으로 혼합이 된다 (2026-08-10) */
const PAYS = [...SPLITTABLE, ...EXCLUSIVE] as readonly string[];

/**
 * 정비 한 건 — 펼치면 품목과 고치기·취소가 나온다.
 *
 * ⭐ 품목 줄도 고칠 수 있다 (사장님 요청 2026-08-05 — "수정도 더 자유롭게").
 *    수량·단가 수정, 줄 삭제·추가 — 재고는 서버가 따라 맞춘다 (line-edit.tsx).
 *    MARS 전송완료 건을 고치면 금액이 어긋난다는 경고가 뜬다.
 */
export function SaleCard({
  sale: s,
  select,
  owner = false,
}: {
  sale: SaleRow;
  /** ⭐ MARS 올리기 선택 모드 (사장님 지시 2026-08-09) — 있으면 카드가 체크박스가 된다 */
  select?: { eligible: boolean; checked: boolean; toggle: () => void; reason?: string | null };
  /** ⭐ 손님·거래처 바꾸기는 사장님만 (2026-08-17) — 돈의 주인이 바뀌는 일이다 */
  owner?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  /** 손님·거래처 바꾸기 패널 (2026-08-17) */
  const [reassigning, setReassigning] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** MARS 전송완료 건 취소는 두 번 묻는다 */
  const [askMars, setAskMars] = useState(false);

  const [workDate, setWorkDate] = useState(s.workDate);
  /**
   * ⭐ 결제수단 여러 개 + 수단별 금액 (사장님 요청 2026-08-10).
   *    옛 「혼합」 건(분할 내역 없음)은 아무것도 안 골린 채 시작한다 — 새로 고르면 된다.
   */
  const [payM, setPayM] = useState<string[]>(
    s.payments.length
      ? s.payments.map((p) => p.method)
      : s.paymentMethod && s.paymentMethod !== "혼합"
        ? [s.paymentMethod]
        : [],
  );
  const [payA, setPayA] = useState<Record<string, string>>(
    Object.fromEntries(s.payments.map((p) => [p.method, String(p.amount)])),
  );
  const [memo, setMemo] = useState(s.paymentMemo ?? "");
  /** ⭐ 주행거리 (2026-08-17) — 없으면 MARS 체크가 막히니 여기서 채운다 */
  const [km, setKm] = useState(s.mileage !== null ? String(s.mileage) : "");

  const canceled = s.status === "취소";
  /** ⭐ 거래처는 제 컬럼에서 (2026-08-17) — 전에는 walkIn 글자에 뭉뚱그려져 있었다 */
  // 거래처가 먼저 — 거래처 판매에 차량이 달린 건(2026-08-21)은 거래처 이름으로 보이고 번호판은 옆에 붙는다
  const who =
    (s.supplierName ? `거래처 ${s.supplierName}` : null) ?? s.customerName ?? s.walkIn ?? "손님 미지정";

  const splitPay = SPLITTABLE as readonly string[];
  const paySum = payM.reduce((sum, m) => sum + Number(payA[m] || "0"), 0);
  /** 복합결제 스위치 — 켰을 때만 2개 이상 (사장님 요청 2026-08-10). 분할 건은 켠 채로 시작 */
  const [combo, setCombo] = useState(s.payments.length >= 2);
  const toggleCombo = () => {
    setError(null);
    setCombo((on) => {
      if (on) {
        setPayM((prev) => {
          const first = prev.find((m) => splitPay.includes(m));
          return first ? [first] : prev;
        });
        setPayA({});
        return false;
      }
      setPayM((prev) => (prev.every((m) => splitPay.includes(m)) && prev.length ? prev : ["카드"]));
      return true;
    });
  };
  const togglePay = (p: string) => {
    setError(null);
    if ((EXCLUSIVE as readonly string[]).includes(p)) {
      setCombo(false);
      setPayM((prev) => (prev.length === 1 && prev[0] === p ? [] : [p]));
      setPayA({});
      return;
    }
    // 복합결제가 꺼져 있으면 하나만 — 누르면 바뀐다
    if (!combo) {
      setPayM([p]);
      setPayA({});
      return;
    }
    setPayM((prev) => {
      const cur = prev.filter((m) => splitPay.includes(m));
      if (cur.includes(p)) {
        const next = cur.filter((m) => m !== p);
        setPayA((a) => {
          const rest = { ...a };
          delete rest[p];
          return rest;
        });
        return next;
      }
      // 새 수단을 고르는 순간 나머지 금액이 자동으로 (사장님 요청 2026-08-10)
      setPayA((a) => {
        const used = cur.reduce((sum, m) => sum + Number(a[m] || "0"), 0);
        return cur.length === 0
          ? { [p]: String(s.totalAmount) }
          : { ...a, [p]: String(s.totalAmount - used) }; // 마이너스 판매면 나머지도 마이너스 (2026-08-21)
      });
      return [...cur, p];
    });
  };

  function saveHead() {
    if (payM.length >= 2 && paySum !== s.totalAmount) {
      setError(
        `분할 금액 합계(${won(paySum)}원)가 판매 합계(${won(s.totalAmount)}원)와 다릅니다 — 금액을 맞춰 주세요`,
      );
      return;
    }
    start(async () => {
      setError(null);
      const r = await updateSaleHead({
        quoteId: s.quoteId,
        workDate,
        paymentMethod: payM.length === 1 ? payM[0] : null,
        payments: payM.length >= 2 ? payM.map((m) => ({ method: m, amount: Number(payA[m] || "0") })) : null,
        paymentMemo: memo || null,
        // 비워 두면 안 건드린다 — 지우는 기능은 일부러 없다 (MARS 가 주행거리 없는 전기를 막는다)
        mileage: km === "" ? undefined : Number(km),
      });
      if (!r.ok) return setError(r.error);
      setEditing(false);
      router.refresh();
    });
  }

  function doCancel(confirmMars: boolean) {
    start(async () => {
      setError(null);
      const r = await cancelSale(s.quoteId, confirmMars);
      if (!r.ok) {
        if (r.needMarsConfirm) return setAskMars(true);
        return setError(r.error);
      }
      setAskMars(false);
      setNotice(
        `취소했습니다 — 재고 ${r.restored}개가 되살아났습니다.` +
          (r.marsWarning ? ` ⚠️ ${r.marsWarning}` : ""),
      );
      router.refresh();
    });
  }

  return (
    <li
      className={`rounded-card border bg-white shadow-card ${
        canceled ? "border-slate-200 opacity-60" : "border-slate-200"
      } ${
        // 선택 모드: 체크된 카드는 테두리로, 체크 못 하는 카드는 흐리게
        select ? (select.checked ? "ring-2 ring-indigo-600" : select.eligible ? "" : "opacity-40") : ""
      }`}
    >
      {/* ⭐ PC 는 카드가 세로로 크고 내용이 더 드러난다 (사장님 요청 2026-08-08) — 폰은 그대로 */}
      <button
        type="button"
        onClick={() => (select ? select.eligible && select.toggle() : setOpen(!open))}
        className="w-full rounded-card p-3 text-left transition-colors active:bg-slate-50 lg:p-5 lg:hover:bg-slate-50"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-semibold lg:text-lg">
            {select && select.eligible && (
              <span
                className={`mr-2 inline-block h-5 w-5 shrink-0 translate-y-1 rounded border-2 text-center text-sm leading-4 ${
                  select.checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                }`}
              >
                {select.checked ? "✓" : ""}
              </span>
            )}
            {canceled && <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-xs">취소</span>}
            {/* ⭐ 예약 배지 (예약거래 2026-09-01) */}
            {!canceled && s.reservationStatus === "예약중" && (
              <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800">📌 예약중</span>
            )}
            {!canceled && s.reservationStatus === "시공완료" && (
              <span className="mr-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                시공 ✓{s.fulfilledOn ? ` ${s.fulfilledOn.slice(5)}` : ""}
              </span>
            )}
            {who}
            {/* ⭐ 차종도 같이 — 「현대 카니발 23나1111」 (사장님 요청 2026-08-09) */}
            {(s.plateNo || s.vehicleModel) && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                {[s.makerName, s.vehicleModel, s.plateNo].filter(Boolean).join(" ")}
              </span>
            )}
          </span>
          <span className={`tabular shrink-0 font-bold lg:text-xl ${canceled ? "line-through" : ""}`}>
            {won(s.totalAmount)}원
          </span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-slate-500 lg:mt-1 lg:text-sm">
          {/* 폰: 한 줄 요약 (지금까지 그대로) */}
          <span className="truncate lg:hidden">
            {/* ⭐ 타이어 규격도 같이 (사장님 요청 2026-08-07) */}
            {s.lines
              .map((l) => `${l.description}${l.spec ? ` ${l.spec}` : ""}${l.qty > 1 ? ` ×${l.qty}` : ""}`)
              .join(" · ") || "품목 없음"}
          </span>
          <span className="hidden lg:block" />
          <span className="tabular shrink-0">
            {/* 분할 결제는 「카드+현금」 으로 (2026-08-10) — 금액은 펼치면 나온다 */}
            {s.payments.length ? s.payments.map((p) => p.method).join("+") : (s.paymentMethod ?? "")}
            {/* ⭐ 외상 잔액 (2026-08-11) — 접힌 채로도 얼마 남았는지 보인다 */}
            {s.paymentMethod === "외상" && !canceled && (() => {
              const remain = s.totalAmount - s.collections.reduce((sum, c) => sum + c.amount, 0);
              return remain > 0 ? (
                <span className="ml-1.5 font-semibold text-red-600">잔액 {won(remain)}</span>
              ) : (
                <span className="ml-1.5 font-semibold text-emerald-700">완납</span>
              );
            })()}
            {/* ⭐ 카드 일마감 표식 (2026-08-26) — POS 결제와 이어졌나 */}
            {!canceled && s.posMatch === "ok" && <span className="ml-1.5 font-semibold text-sky-700">포스 ✓</span>}
            {!canceled && s.posMatch === "missing" && (
              <Link href={`/finance/card?ym=${s.workDate.slice(0, 7)}&d=${s.workDate}`} className="ml-1.5 font-semibold text-amber-600 underline">
                POS에 없음
              </Link>
            )}
            {/* ⭐ MARS 표식 (사장님 지시 2026-08-09) — ✓ 올라감 · 올리는 중 = 체크 후 대기 */}
            {s.marsStatus === "전송완료" && <span className="ml-1.5 font-semibold text-indigo-600">MARS ✓</span>}
            {s.marsStatus === "미전송" && !canceled && (
              <span className="ml-1.5 text-amber-600">MARS 올리는 중</span>
            )}
          </span>
        </div>
        {/* ⭐ 선택 모드에서 체크가 막힌 이유 (사장님 지시 2026-08-17) — 이유 없이 안 눌리면 답답하다 */}
        {select && !select.eligible && select.reason && (
          <p className="mt-1 text-xs font-medium text-amber-700">⚠️ {select.reason}</p>
        )}
        {/* PC: 품목을 줄별로 펼쳐서 — 펼치지 않아도 무엇을 얼마에 했는지 보인다 */}
        <div className="mt-2 hidden space-y-1 lg:block">
          {s.lines.map((l) => (
            <div key={l.itemId} className="flex items-baseline justify-between gap-3 text-sm text-slate-600">
              <span className="min-w-0 truncate">
                {l.lineType === "service" && <span className="mr-1 text-xs text-slate-400">공임</span>}
                {l.lineType === "use" && <span className="mr-1 text-xs text-sky-600">부품 사용</span>}
                {l.description}
                {l.spec && <span className="tabular ml-1 text-slate-500">{l.spec}</span>}
              </span>
              {/* ⭐ 「4 × 142,000 = 568,000원」 — 총액이 맨 끝에 (사장님 요청 2026-08-21). 1개면 금액만 */}
              <span className="tabular shrink-0">
                {l.qty > 1 ? (
                  <>
                    <span className="text-slate-500">
                      {l.qty} × {won(l.finalPrice)} =
                    </span>{" "}
                    <span className="font-semibold text-slate-800">{won(l.finalPrice * l.qty)}원</span>
                  </>
                ) : (
                  <>{won(l.finalPrice)}원</>
                )}
              </span>
            </div>
          ))}
          {s.lines.length === 0 && <div className="text-sm text-slate-400">품목 없음</div>}
        </div>
        {/* ⭐ 판매 등록 때 적은 비고 — 펼치지 않아도 보인다 (사장님 요청 2026-08-06) */}
        {s.paymentMemo && <p className="mt-0.5 truncate text-xs text-amber-700 lg:mt-1.5 lg:text-sm">📝 {s.paymentMemo}</p>}
      </button>

      {open && (
        <div className="border-t border-slate-100 p-3">
          {/* ⭐ 줄 단위 수정·삭제·추가 (사장님 요청 2026-08-05 — "수정도 더 자유롭게") */}
          <ul className="space-y-1">
            {s.lines.map((l) =>
              canceled ? (
                <li key={l.itemId} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {l.lineType === "service" && <span className="mr-1 text-xs text-slate-400">공임</span>}
                {l.lineType === "use" && <span className="mr-1 text-xs text-sky-600">부품 사용</span>}
                      {l.description}
                      {l.spec && <span className="tabular ml-1 text-xs text-slate-500">{l.spec}</span>}
                    </span>
                    <span className="tabular shrink-0 text-slate-600">
                      {l.qty > 1 && `${l.qty} × `}
                      {won(l.finalPrice)}원
                    </span>
                  </div>
                  {l.memo && <p className="mt-0.5 pl-1 text-xs text-amber-700">└ 📝 {l.memo}</p>}
                </li>
              ) : (
                <EditableLine key={l.itemId} line={l} onMessage={setNotice} />
              ),
            )}
          </ul>
          {!canceled && <AddLine quoteId={s.quoteId} onMessage={setNotice} owner={owner} />}

          {/* ⭐ 견적서·거래명세서 인쇄 (사장님 요청 2026-08-05) — 새 탭에서 열려 바로 인쇄 */}
          <div className="mt-2 flex gap-2">
            <a
              href={`/print/${s.quoteId}?doc=estimate`}
              target="_blank"
              className="flex-1 rounded-lg border border-slate-300 py-2 text-center text-sm font-medium text-slate-600 active:bg-slate-50"
            >
              🖨 견적서
            </a>
            <a
              href={`/print/${s.quoteId}?doc=statement`}
              target="_blank"
              className="flex-1 rounded-lg border border-slate-300 py-2 text-center text-sm font-medium text-slate-600 active:bg-slate-50"
            >
              🖨 거래명세서
            </a>
          </div>

          {/* 상세 — 등록 시각·바퀴·메모·MARS (사장님 요청 2026-08-05 "더 자세하게") */}
          <div className="mt-2 space-y-0.5 text-xs text-slate-500">
            <p className="tabular">
              {s.quoteNo}
              {s.createdAt && ` · ${s.createdAt} 등록`}
              {/* 분할 결제는 수단별 금액까지 (2026-08-10) — 「카드 30,000 + 현금 5,000」 */}
              {s.payments.length
                ? ` · ${splitLabel(s.payments)}원`
                : s.paymentMethod && ` · ${s.paymentMethod}`}
            </p>
            {/* ⭐ 주행거리 (사장님 요청 2026-08-08) — 그때 입력값이 우선, 없으면 차량 최근값 */}
            {s.mileage !== null ? (
              <p className="tabular">주행거리: {s.mileage.toLocaleString()} km (등록 당시)</p>
            ) : s.vehicleMileage !== null ? (
              <p className="tabular">주행거리: {s.vehicleMileage.toLocaleString()} km (차량 최근 기록)</p>
            ) : null}
            {s.tyrePositions.length > 0 && <p>갈아 끼운 바퀴: {s.tyrePositions.join(" · ")}</p>}
            {s.paymentMemo && <p>메모: {s.paymentMemo}</p>}
            {/* '보류'(아직 안 올림)는 굳이 안 적는다 — 올린 것·안 가는 것만 남긴다 */}
            {s.marsStatus !== "보류" && (
              <p className="tabular">
                MARS{" "}
                {s.marsStatus === "미전송" ? "올리는 중 (매장 PC 대기)" : s.marsStatus}
                {s.marsRefNo && ` · ${s.marsRefNo}`}
              </p>
            )}
            {/* ⭐ 마지막 자동입력 시도 (2026-08-24) — 안 올라간 건이 어디서 멈췄는지.
                  전송완료·해당없음은 결과가 위에 이미 있으니 안 적는다 */}
            {s.marsLastTry &&
              (s.marsStatus === "보류" || s.marsStatus === "미전송" || s.marsStatus === "수동처리") && (
                <p className="tabular text-amber-700">MARS 마지막 시도: {s.marsLastTry}</p>
              )}
          </div>

          {/* ⭐ 외상 수금 (사장님 선택 2026-08-11) */}
          {s.paymentMethod === "외상" && !canceled && (
            <CollectionPanel quoteId={s.quoteId} total={s.totalAmount} collections={s.collections} owner={owner} />
          )}

          {/* ⭐ 손님·거래처 바꾸기 (사장님 지시 2026-08-17) */}
          {owner && reassigning && !canceled && (
            <ReassignPanel
              sale={s}
              onDone={(m) => {
                setNotice(m);
                setReassigning(false);
              }}
            />
          )}

          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
          )}

          {/* ── MARS 전송완료 건 취소 재확인 ── */}
          {askMars && (
            <div className="mt-2 rounded-xl border-2 border-amber-500 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">MARS 에 이미 들어간 판매입니다</p>
              <p className="mt-1 text-xs text-amber-800">
                여기서 취소해도 MARS 에는 남습니다 — <strong>MARS 에서도 직접 지우셔야</strong> 실적이
                맞습니다.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setAskMars(false)}
                  className="flex-1 rounded-lg border border-amber-300 bg-white py-2 text-sm font-medium text-amber-800"
                >
                  그만두기
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => doCancel(true)}
                  className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white"
                >
                  알겠습니다, 취소합니다
                </button>
              </div>
            </div>
          )}

          {!canceled && !askMars && (
            <>
              {editing ? (
                <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                  <label className="block text-xs text-slate-500">
                    작업일
                    <input
                      type="date"
                      value={workDate}
                      onChange={(e) => setWorkDate(e.target.value)}
                      className="tabular mt-0.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  {/* ⭐ 여러 개 고르면 분할 결제 — 고르는 순간 나머지 금액 자동 (2026-08-10) */}
                  <div className="flex flex-wrap gap-1.5">
                    {PAYS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePay(p)}
                        className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${
                          payM.includes(p) ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={toggleCombo}
                      className={`rounded-lg border border-dashed px-2.5 py-1.5 text-sm font-medium ${
                        combo ? "border-indigo-700 bg-indigo-700 text-white" : "border-indigo-400 bg-white text-indigo-700"
                      }`}
                    >
                      복합결제
                    </button>
                  </div>
                  {combo && payM.length >= 2 && (
                    <div className="space-y-1.5">
                      {payM.map((m) => (
                        <label key={m} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-xs text-slate-600">{m}</span>
                          <input
                            value={showSigned(payA[m] ?? "")}
                            onChange={(e) => setPayA((a) => ({ ...a, [m]: signedStr(e.target.value) }))}
                            inputMode="numeric"
                            className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-right text-sm"
                          />
                          <span className="shrink-0 text-xs text-slate-400">원</span>
                        </label>
                      ))}
                      {paySum !== s.totalAmount && (
                        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                          합계 {won(s.totalAmount)}원과 {won(Math.abs(s.totalAmount - paySum))}원 차이
                        </p>
                      )}
                    </div>
                  )}
                  {/* ⭐ 주행거리 (2026-08-17) — 없으면 MARS 자동 올리기가 막힌다 */}
                  <label className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-slate-600">주행거리</span>
                    <input
                      value={km ? Number(km).toLocaleString() : ""}
                      onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                      placeholder={
                        s.vehicleMileage !== null ? `차량 최근값 ${s.vehicleMileage.toLocaleString()}` : "없음"
                      }
                      className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-right text-sm"
                    />
                    <span className="shrink-0 text-xs text-slate-400">km</span>
                  </label>
                  <input
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="메모"
                    className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setEditing(false)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={saveHead}
                      className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      저장
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* ⭐ 시공 완료 (예약거래 2026-09-01) — 이제야 재고가 빠진다. 두 번 눌러도 한 번만 */}
                  {s.reservationStatus === "예약중" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setError(null);
                          const r = await fulfillReservation(s.quoteId);
                          if (!r.ok) return setError(r.error);
                          setNotice(
                            r.shortages.length > 0
                              ? `시공 완료 — ⚠️ 재고 부족: ${r.shortages.join(" · ")} (재주문 확인!)`
                              : "시공 완료 — 재고가 차감됐습니다. 이제 MARS 에 올릴 수 있습니다.",
                          );
                          router.refresh();
                        })
                      }
                      className="w-full rounded-lg bg-violet-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      🔧 시공 완료 — 이제 재고 차감
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
                  >
                    날짜·결제 고치기
                  </button>
                  {/* ⭐ 손님·거래처 바꾸기 (사장님 지시 2026-08-17) — 사장님 계정만 */}
                  {owner && (
                    <button
                      type="button"
                      onClick={() => setReassigning((v) => !v)}
                      className="flex-1 rounded-lg border border-indigo-300 py-2 text-sm font-medium text-indigo-700 active:bg-indigo-50"
                    >
                      {reassigning ? "바꾸기 접기" : "손님·거래처 바꾸기"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => doCancel(false)}
                    className="flex-1 rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 active:bg-red-50"
                  >
                    판매 취소 (재고 복원)
                  </button>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">
                품목마다 「고치기」로 수량·단가를 바꾸거나 지울 수 있습니다 — 재고가 알아서 따라갑니다.
                통째로 잘못 들어갔으면 판매 취소를 쓰세요.
                {s.reservationStatus === "예약중" &&
                  " 예약 건은 아직 재고를 안 뺐습니다 — 취소해도 재고는 그대로고, 환불은 마이너스 단가 줄이나 카드 취소로 처리하세요."}
              </p>
            </>
          )}
        </div>
      )}
    </li>
  );
}
