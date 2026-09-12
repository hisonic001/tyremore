"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelSale, convertToReservation, fulfillReservation, updateSaleHead, updateSaleMemo } from "@/lib/sale-edit";
import Link from "@/lib/link";
import type { SaleRow } from "@/lib/sale-history";
import { EXCLUSIVE, SPLITTABLE, splitLabel } from "@/lib/payments";
import { signedStr, showSigned } from "@/lib/signed-input";
import { SquareArrowOutUpRight } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm";
import { CollectionPanel } from "./collections";
import { ReservationFixPanel } from "./reservation-fix";
import { AddLine, EditableLine } from "./line-edit";
import { ReassignPanel } from "./reassign";

const won = (n: number) => n.toLocaleString("ko-KR");
/** ⭐ 혼합은 이제 직접 고르지 않는다 — 수단을 2개 이상 고르면 자동으로 혼합이 된다 (2026-08-10) */
const PAYS = [...SPLITTABLE, ...EXCLUSIVE] as readonly string[];

/**
 * ⭐ 결제 한 줄 (버그 수정 2026-09-12 — 사장님 제보 Q26-0910-002).
 *
 *    전에는 금액을 `{ 카드: "200000" }` 처럼 **수단 이름을 열쇠로** 담았다.
 *    카드로 세 번 나눠 받은 건(200,000 + 854,000 + 200,000)은 열쇠가 겹쳐
 *    마지막 값만 남고, 저장할 때 줄 수만큼 그 값이 복제돼 세 칸이 전부
 *    200,000 이 되고 「654,000원 차이」가 떴다.
 *    이제 줄마다 제 금액·제 날짜를 든다 — 같은 수단이 여러 줄이어도 서로 독립이다.
 */
type PayLine = {
  /** 화면 열쇠 — 수단 이름은 겹칠 수 있어 열쇠로 못 쓴다 */
  key: number;
  method: string;
  /** 입력칸 글자 그대로 (마이너스 입력 중인 "-" 도 담아야 해서 문자열) */
  amount: string;
  /**
   * ⭐ 받은 날 — 화면엔 안 내보내고 **저장할 때 그대로 돌려보내기만** 한다 (2026-09-12).
   *    서버(sale-edit.ts)는 quote_payment 를 전부 지우고 다시 넣는다. 화면이 paidOn 을
   *    안 실어 보내던 탓에 「고치기」만 눌러도 받은 날이 전부 null 이 됐고, 다른 날 받은
   *    잔금이 카드 일마감 대조(card-recon·pos-close)에서 사라졌다.
   */
  paidOn: string | null;
};

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
  echo,
  owner = false,
  canCollect = false,
  canReassign = false,
}: {
  sale: SaleRow;
  /** ⭐ MARS 올리기 선택 모드 (사장님 지시 2026-08-09) — 있으면 카드가 체크박스가 된다 */
  select?: { eligible: boolean; checked: boolean; toggle: () => void; reason?: string | null };
  /**
   * ⭐ 재등장 카드 (사장님 지시 2026-09-05) — 시공한 날·수금한 날에 원래 카드가
   *    이 배지를 달고 다시 뜬다. 그날 매출 합계에는 안 들어간 카드라는 표시이기도 하다.
   */
  echo?: { kind: "시공" | "수금"; note: string };
  /** ⭐ 매입가·마진 표시 (2026-09-02 — cost 스위치. 전엔 owner 하나가 세 용도를 겸직) */
  owner?: boolean;
  /** 외상 수금 UI (receivable_view 스위치) */
  canCollect?: boolean;
  /** 손님·거래처 바꾸기 (reassign 스위치) */
  canReassign?: boolean;
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
  /* 예약 전환·확인 시트 (2026-09-09) — 브라우저 confirm() 금지 관례(useConfirm) */
  const [ask, confirmDialog] = useConfirm();

  const [workDate, setWorkDate] = useState(s.workDate);
  /**
   * ⭐ 결제수단 여러 개 + 수단별 금액 (사장님 요청 2026-08-10).
   *    옛 「혼합」 건(분할 내역 없음)은 아무것도 안 골린 채 시작한다 — 새로 고르면 된다.
   *
   *    ⭐ 2026-09-12: 수단 이름을 열쇠로 쓰던 Record 를 **줄 배열(PayLine)** 로 바꿨다.
   *       같은 수단이 여러 줄인 건(예약금·잔금이 자동 전환된 판매 — reservation-pay.ts)이
   *       한 칸으로 뭉개지던 버그. 자세한 사정은 PayLine 주석 참고.
   */
  /** 줄 열쇠 발급기 — 값이 뭐든 상관없고 겹치지만 않으면 된다 */
  const payKey = useRef(0);
  const newPayLine = (method: string, amount = "", paidOn: string | null = null): PayLine => ({
    key: payKey.current++,
    method,
    amount,
    paidOn,
  });
  const [payLines, setPayLines] = useState<PayLine[]>(() =>
    s.payments.length
      ? s.payments.map((p) => newPayLine(p.method, String(p.amount), p.paidOn))
      : s.paymentMethod && s.paymentMethod !== "혼합"
        ? [newPayLine(s.paymentMethod)]
        : [],
  );
  /** 고른 수단 목록 — 단추 표시·저장 판단은 전과 같이 이것만 본다 */
  const payM = payLines.map((l) => l.method);
  const [memo, setMemo] = useState(s.paymentMemo ?? "");
  /** ⭐ 주행거리 (2026-08-17) — 없으면 MARS 체크가 막히니 여기서 채운다 */
  const [km, setKm] = useState(s.mileage !== null ? String(s.mileage) : "");

  const canceled = s.status === "취소";
  /** ⭐ 거래처는 제 컬럼에서 (2026-08-17) — 전에는 walkIn 글자에 뭉뚱그려져 있었다 */
  // 거래처가 먼저 — 거래처 판매에 차량이 달린 건(2026-08-21)은 거래처 이름으로 보이고 번호판은 옆에 붙는다
  const who =
    (s.supplierName ? `거래처 ${s.supplierName}` : null) ?? s.customerName ?? s.walkIn ?? "손님 미지정";

  const splitPay = SPLITTABLE as readonly string[];
  // 줄마다 제 금액을 들고 있으니 그냥 더하면 된다 (전에는 수단 이름으로 금액을 찾다가 겹쳤다)
  const paySum = payLines.reduce((sum, l) => sum + Number(l.amount || "0"), 0);
  /** 복합결제 스위치 — 켰을 때만 2개 이상 (사장님 요청 2026-08-10). 분할 건은 켠 채로 시작 */
  const [combo, setCombo] = useState(s.payments.length >= 2);
  const toggleCombo = () => {
    setError(null);
    setCombo((on) => {
      if (on) {
        setPayLines((prev) => {
          const first = prev.find((l) => splitPay.includes(l.method));
          // 끄면 수단 하나만 남는다 — 금액칸이 사라지므로 금액은 비운다 (전과 같다).
          // 받은 날은 굳이 안 지운다 — 다시 켤 때 그 줄의 날짜가 살아 있는 편이 낫다
          return first ? [{ ...first, amount: "" }] : prev.map((l) => ({ ...l, amount: "" }));
        });
        return false;
      }
      setPayLines((prev) =>
        prev.length && prev.every((l) => splitPay.includes(l.method)) ? prev : [newPayLine("카드")],
      );
      return true;
    });
  };
  const togglePay = (p: string) => {
    setError(null);
    if ((EXCLUSIVE as readonly string[]).includes(p)) {
      setCombo(false);
      setPayLines((prev) =>
        prev.length === 1 && prev[0].method === p ? [] : [newPayLine(p)],
      );
      return;
    }
    // 복합결제가 꺼져 있으면 하나만 — 누르면 바뀐다
    if (!combo) {
      setPayLines([newPayLine(p)]);
      return;
    }
    setPayLines((prev) => {
      const cur = prev.filter((l) => splitPay.includes(l.method));
      // 켜져 있던 수단을 다시 누르면 그 수단 줄을 뺀다 — 같은 수단이 여러 줄이면 함께 빠진다
      // (단추가 수단마다 하나뿐이라 전부터 그랬다. 줄 하나만 빼는 기능은 여기 없다)
      if (cur.some((l) => l.method === p)) return cur.filter((l) => l.method !== p);
      // 새 수단을 고르는 순간 나머지 금액이 자동으로 (사장님 요청 2026-08-10)
      const used = cur.reduce((sum, l) => sum + Number(l.amount || "0"), 0);
      // 마이너스 판매면 나머지도 마이너스 (2026-08-21)
      const rest = cur.length === 0 ? s.totalAmount : s.totalAmount - used;
      return [...cur, newPayLine(p, String(rest))];
    });
  };

  function saveHead() {
    if (payLines.length >= 2 && paySum !== s.totalAmount) {
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
        paymentMethod: payLines.length === 1 ? payLines[0].method : null,
        // ⭐ 받은 날(paidOn)까지 그대로 돌려보낸다 (2026-09-12) — 서버가 quote_payment 를
        //    지우고 다시 넣으므로, 안 보내면 손 안 댄 줄의 받은 날까지 null 이 된다
        payments:
          payLines.length >= 2
            ? payLines.map((l) => ({ method: l.method, amount: Number(l.amount || "0"), paidOn: l.paidOn }))
            : null,
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

  /**
   * ⭐ 영수증형 개별 카드 (사장님 재피드백 2026-09-04 — 모형 3안 중 선택).
   *    1차 개편(날짜 카드 속 한 줄 행)이 품목을 한 줄로 뭉개 명확성을 죽였다.
   *    정비마다 카드 한 장, 안은 영수증: 이름·차량 / 품목 줄별 금액 /
   *    결제수단 ↔ 합계 크게 / 문제 배지만. 정상 완료 건은 배지 0개 —
   *    MARS ✓·포스 ✓·완납·시공 ✓ 은 펼치면 보인다.
   */
  /**
   * ⭐ 받은 몫 (사장님 지시 2026-09-11 — "예약을 하면서 당일에 돈을 일부나 전부를 치른
   *    경우는 한개의 카드로 나와야함"). 같은 날 수금 카드가 따로 안 뜨는 대신
   *    접힌 카드가 「받음 200,000원 (카드 09-10) · 잔금 …」 을 직접 말한다.
   *    외상(예약금·본사청구 고객 부담 포함)이 아니면 0 — 잔금 셈은 전과 같다.
   */
  const paid =
    s.paymentMethod === "외상" && !canceled ? s.collections.reduce((sum, c) => sum + c.amount, 0) : 0;
  const remain = s.paymentMethod === "외상" && !canceled ? s.totalAmount - paid : 0;
  /** 「카드 09-10」 — 여러 번 받았으면 마지막 것 + 「외 N건」 (펼치면 다 보인다) */
  const lastColl = paid > 0 ? s.collections[s.collections.length - 1] : null;
  const paidWhen = lastColl
    ? `${lastColl.method} ${lastColl.paidOn.slice(5)}${s.collections.length > 1 ? ` 외 ${s.collections.length - 1}건` : ""}`
    : "";
  const hasBadges =
    canceled ||
    s.reservationStatus === "예약중" ||
    remain > 0 ||
    (!canceled && s.posMatch === "missing") ||
    (!canceled && s.marsStatus === "미전송");

  return (
    <li
      className={`rounded-card border border-slate-200 bg-white shadow-card ${canceled ? "opacity-60" : ""} ${
        // 선택 모드: 체크된 카드는 테두리로, 체크 못 하는 카드는 흐리게
        select ? (select.checked ? "ring-2 ring-indigo-600" : select.eligible ? "" : "opacity-40") : ""
      }`}
    >
      {confirmDialog}
      <button
        type="button"
        onClick={() => (select ? select.eligible && select.toggle() : setOpen(!open))}
        className="w-full rounded-card p-3 text-left transition-colors active:bg-slate-50 lg:hover:bg-slate-50"
      >
        {/* ── 재등장 배지 (2026-09-05) — 시공한 날·수금한 날의 카드임을 맨 위에서 알린다 ── */}
        {echo && (
          <div className="mb-2">
            <StatusPill tone={echo.kind === "수금" ? "success" : "reserve"}>
              {echo.kind === "수금" ? "💰 외상 수금" : "🔧 시공 완료"} {echo.note}
            </StatusPill>
          </div>
        )}
        {/* ── 머리: 누구 · 무슨 차 ── */}
        <div className="flex items-baseline gap-2">
          {select && select.eligible && (
            <span
              className={`inline-block h-5 w-5 shrink-0 translate-y-0.5 rounded border-2 text-center text-sm leading-4 ${
                select.checked ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
              }`}
            >
              {select.checked ? "✓" : ""}
            </span>
          )}
          <span className="min-w-0 truncate text-[15px] font-semibold leading-snug">{who}</span>
          {/* ⭐ 차종도 같이 — 「현대 카니발 23나1111」 (사장님 요청 2026-08-09) */}
          {(s.plateNo || s.vehicleModel) && (
            <span className="min-w-0 truncate text-[13px] text-slate-500">
              {[s.makerName, s.vehicleModel, s.plateNo].filter(Boolean).join(" ")}
            </span>
          )}
          {/* ⭐ 고객·차량 한 장 바로가기 ↗ (사장님 요청 2026-09-05) — 카드 펼침을 막고
                이동한다 (POS 배지와 같은 검증된 방식). 개인은 차량 한 장(고객 정보 포함),
                거래처는 거래처 화면(그 이름으로 걸러짐). 둘 다 없으면 칩 없음 */}
          {(s.supplierName || s.vehicleId !== null) && (
            <Link
              href={
                s.supplierName
                  ? `/settings/suppliers?q=${encodeURIComponent(s.supplierName)}`
                  : `/vehicle/${s.vehicleId}`
              }
              onClick={(e) => e.stopPropagation()}
              title={s.supplierName ? "거래처 정보 보기" : "차량·고객 정보 보기"}
              className="shrink-0 self-center rounded-lg px-1.5 py-1 text-slate-400 active:bg-slate-100 lg:hover:text-slate-600"
            >
              <SquareArrowOutUpRight className="size-3.5" />
            </Link>
          )}
        </div>

        {/* ── 품목 — 줄별 금액 (옛 PC 카드 문법을 전 화면으로, 2026-09-04) ── */}
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {s.lines.map((l) => (
            <div key={l.itemId}>
              <div className="flex items-baseline justify-between gap-3 text-sm text-slate-600">
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
                      <span className="text-slate-400">
                        {l.qty} × {won(l.finalPrice)} =
                      </span>{" "}
                      <span className="font-medium text-slate-700">{won(l.finalPrice * l.qty)}원</span>
                    </>
                  ) : (
                    <>{won(l.finalPrice)}원</>
                  )}
                </span>
              </div>
              {/* ⭐ 줄 메모도 접힌 채로 (사장님 요청 2026-09-09 — "각 품목·공임 메모가 바로 보였으면") */}
              {l.memo && <p className="truncate pl-3 text-[12px] leading-snug text-amber-700">└ {l.memo}</p>}
            </div>
          ))}
          {s.lines.length === 0 && <div className="text-sm text-slate-400">품목 없음</div>}
        </div>

        {/* ── 합계: 결제수단 ↔ 총액 크게 ── */}
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
          {/* 분할 결제는 「카드+현금」 으로 (2026-08-10) — 수단별 금액은 펼치면 나온다 */}
          <span className="text-[13px] text-slate-500">
            {/* ⭐ 본사청구 (2026-09-10) — 저장은 「외상」이지만 받을 상대가 제조사다 */}
            {s.claimParty
              ? `본사청구 · ${s.claimParty}`
              : s.payments.length
                // 같은 수단이 날짜만 다르게 여러 줄이면(예약금+잔금) 한 번만 (2026-09-10)
                ? [...new Set(s.payments.map((p) => p.method))].join("+")
                : (s.paymentMethod ?? "")}
          </span>
          <span
            className={`tabular shrink-0 text-[18px] font-extrabold leading-snug ${canceled ? "text-slate-400 line-through" : ""}`}
          >
            {won(s.totalAmount)}원
          </span>
        </div>
        {/* ⭐ 받은 몫 한 줄 (2026-09-11) — 예약은 아래 배지 줄이 「예약금 … 받음」으로 잇는다 */}
        {paid > 0 && s.reservationStatus !== "예약중" && (
          <p className="tabular mt-1 text-[13px] text-slate-600">
            받음 {won(paid)}원 <span className="text-slate-400">({paidWhen})</span>
            {remain > 0 ? ` · 잔금 ${won(remain)}원` : " · 완납"}
          </p>
        )}
        {/* ⭐ 문제 배지 줄 — 지금 신경 쓸 것만 (사장님 답변 2026-09-04). 없으면 줄 자체가 없다 */}
        {hasBadges && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {canceled && <StatusPill>취소</StatusPill>}
            {!canceled && s.reservationStatus === "예약중" && <StatusPill tone="reserve">📌 예약중</StatusPill>}
            {/* 예약금 받은 몫 — 「📌 예약중 · 예약금 200,000원 받음 · 잔금 …」 으로 읽힌다 (2026-09-11) */}
            {!canceled && s.reservationStatus === "예약중" && paid > 0 && (
              <StatusPill tone="reserve">
                예약금 {won(paid)}원 받음{remain <= 0 ? " · 완납" : ""}
              </StatusPill>
            )}
            {/* ⭐ 외상 잔액 (2026-08-11) — 접힌 채로도 얼마 남았는지 보인다.
                ⭐ 무슨 돈인지까지 (2026-09-10) — 예약 잔금은 아직 시공 전이라 독촉할 돈이
                   아니고, 본사청구 잔액은 제조사에 청구할 돈이다. 같은 붉은 배지로 묶으면
                   「밀린 외상」이 얼마인지가 흐려진다 */}
            {remain > 0 &&
              (s.reservationStatus === "예약중" ? (
                <StatusPill tone="reserve">잔금 {won(remain)}원</StatusPill>
              ) : s.claimParty ? (
                <StatusPill tone="info">{s.claimParty} 청구 {won(remain)}원</StatusPill>
              ) : (
                <StatusPill tone="error">외상 잔액 {won(remain)}원</StatusPill>
              ))}
            {/* ⭐ 카드 일마감 (2026-08-26) — POS 결제와 안 이어진 건. 누르면 일마감 화면 */}
            {!canceled && s.posMatch === "missing" && (
              <Link
                href={`/finance/card?ym=${s.workDate.slice(0, 7)}&d=${s.workDate}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 underline underline-offset-2"
              >
                POS에 없음
              </Link>
            )}
            {/* MARS 미전송 = 체크 후 로봇 대기 (사장님 지시 2026-08-09) */}
            {!canceled && s.marsStatus === "미전송" && <StatusPill tone="warn">MARS 올리는 중</StatusPill>}
          </div>
        )}
        {/* ⭐ 선택 모드에서 체크가 막힌 이유 (사장님 지시 2026-08-17) — 이유 없이 안 눌리면 답답하다 */}
        {select && !select.eligible && select.reason && (
          <p className="mt-1 text-xs font-medium text-amber-700">⚠️ {select.reason}</p>
        )}
        {/* ⭐ 판매 등록 때 적은 비고 — 펼치지 않아도 보인다 (사장님 요청 2026-08-06) */}
        {s.paymentMemo && <p className="mt-1 truncate text-[13px] text-amber-700">📝 {s.paymentMemo}</p>}
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
            {/* ⭐ 정상 표식은 접힌 행에서 뺐다 (2026-09-04 개편) — 여기서 확인한다 */}
            {!canceled && s.reservationStatus === "시공완료" && (
              <p className="tabular text-emerald-700">시공 완료 ✓{s.fulfilledOn ? ` ${s.fulfilledOn.slice(5)}` : ""}</p>
            )}
            {!canceled && s.posMatch === "ok" && <p className="text-sky-700">포스 일마감 확인 ✓</p>}
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

          {/* ⭐ 비고 바로 고치기 (사장님 요청 2026-09-09 — "카드 한번만 누르면 하단에서") */}
          {!canceled && (
            <div className="mt-3 rounded-lg bg-slate-50 p-2.5">
              <label className="text-xs font-medium text-slate-500">📝 비고</label>
              <div className="mt-1 flex items-start gap-2">
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={2}
                  placeholder="예: 다음 방문 때 위치교환 · 좌뒤 슬로우펑크 관찰"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-slate-900"
                />
                <button
                  type="button"
                  disabled={pending || memo === (s.paymentMemo ?? "")}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await updateSaleMemo(s.quoteId, memo);
                      if (!r.ok) return setError(r.error);
                      setNotice("비고를 저장했습니다");
                      router.refresh();
                    })
                  }
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  저장
                </button>
              </div>
            </div>
          )}

          {/* ⭐ 외상 수금 (사장님 선택 2026-08-11) — 예약이면 「예약금·잔금 받기」 (2026-09-10) */}
          {s.paymentMethod === "외상" && !canceled && (
            <CollectionPanel
              quoteId={s.quoteId}
              total={s.totalAmount}
              collections={s.collections}
              owner={canCollect}
              reserved={!!s.reservationStatus && !s.claimParty}
            />
          )}
          {/* ⭐ 전액 받은 것으로 저장된 예약 — 실제 받은 돈으로 고치는 자리 (2026-09-10).
              실측 예약중 8건 전부 이 모양이었다. 수금 권한이 있어야 고친다 */}
          {canCollect &&
            !canceled &&
            s.reservationStatus === "예약중" &&
            s.paymentMethod !== "외상" &&
            s.paymentMethod !== "서비스" &&
            !s.claimParty && (
              <ReservationFixPanel
                quoteId={s.quoteId}
                total={s.totalAmount}
                paymentMethod={s.paymentMethod}
                memo={s.paymentMemo}
              />
            )}

          {/* ⭐ 손님·거래처 바꾸기 (사장님 지시 2026-08-17) */}
          {canReassign && reassigning && !canceled && (
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
                  {combo && payLines.length >= 2 && (
                    <div className="space-y-1.5">
                      {/* 줄 열쇠는 순번(key) — 수단 이름으로 묶으면 카드 3장 건이 한 칸으로 뭉갠다 (2026-09-12) */}
                      {payLines.map((l, i) => (
                        <label key={l.key} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-xs text-slate-600">{l.method}</span>
                          <input
                            value={showSigned(l.amount)}
                            onChange={(e) =>
                              setPayLines((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, amount: signedStr(e.target.value) } : x)),
                              )
                            }
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
                          // ⭐ 잔금이 남았으면 그걸 먼저 말한다 (2026-09-10) — 시공 완료 = 돈 받을 순간
                          const due = remain > 0 ? ` 잔금 ${won(remain)}원을 아래 「예약금·잔금 받기」에서 받아 주세요 —` : "";
                          setNotice(
                            r.shortages.length > 0
                              ? `시공 완료 — ⚠️ 재고 부족: ${r.shortages.join(" · ")} (재주문 확인!)${due}`
                              : `시공 완료 — 재고가 차감됐습니다.${due}${remain > 0 ? " 받으면 MARS 에 올릴 수 있습니다." : " 이제 MARS 에 올릴 수 있습니다."}`,
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
                  {/* ⭐ 예약으로 바꾸기 (사장님 요청 2026-09-09) — 잘못 등록한 일반·외상 판매를
                        예약으로. 재고가 되살아나고 시공 완료 때 다시 빠진다 */}
                  {s.reservationStatus !== "예약중" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={async () => {
                        const ok = await ask({
                          title: "이 판매를 예약으로 바꿀까요?",
                          body: "예약은 재고를 안 뺀 상태입니다 — 지금 빠져 있던 재고가 되살아나고, 나중에 「시공 완료」를 누르면 다시 빠집니다. 결제·수금 기록은 그대로 둡니다.",
                          confirmLabel: "예약으로 바꾸기",
                        });
                        if (!ok) return;
                        start(async () => {
                          setError(null);
                          let r = await convertToReservation(s.quoteId);
                          if (!r.ok && r.needMarsConfirm) {
                            const again = await ask({
                              title: "MARS 에 이미 들어간 판매입니다",
                              body: r.error,
                              confirmLabel: "그래도 예약으로",
                              tone: "danger",
                            });
                            if (!again) return;
                            r = await convertToReservation(s.quoteId, true);
                          }
                          if (!r.ok) return setError(r.error);
                          setNotice(
                            `예약으로 바꿨습니다 — 재고 ${r.restored}개가 되살아났습니다.` +
                              (r.marsWarning ? ` ⚠️ ${r.marsWarning}` : ""),
                          );
                          router.refresh();
                        });
                      }}
                      className="flex-1 rounded-lg border border-violet-300 py-2 text-sm font-medium text-violet-700 active:bg-violet-50"
                    >
                      📌 예약으로 바꾸기
                    </button>
                  )}
                  {/* ⭐ 손님·거래처 바꾸기 (사장님 지시 2026-08-17) — 사장님 계정만 */}
                  {canReassign && (
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
