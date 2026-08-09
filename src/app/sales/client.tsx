"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelSale, updateSaleHead } from "@/lib/sale-edit";
import type { SaleRow } from "@/lib/sale-history";
import { AddLine, EditableLine } from "./line-edit";

const won = (n: number) => n.toLocaleString("ko-KR");
const PAYS = ["현금", "카드", "계좌이체", "외상", "혼합", "서비스"] as const;

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
}: {
  sale: SaleRow;
  /** ⭐ MARS 올리기 선택 모드 (사장님 지시 2026-08-09) — 있으면 카드가 체크박스가 된다 */
  select?: { eligible: boolean; checked: boolean; toggle: () => void };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** MARS 전송완료 건 취소는 두 번 묻는다 */
  const [askMars, setAskMars] = useState(false);

  const [workDate, setWorkDate] = useState(s.workDate);
  const [pay, setPay] = useState(s.paymentMethod ?? "");
  const [memo, setMemo] = useState(s.paymentMemo ?? "");

  const canceled = s.status === "취소";
  const who = s.customerName ?? s.walkIn ?? "손님 미지정";

  function saveHead() {
    start(async () => {
      setError(null);
      const r = await updateSaleHead({
        quoteId: s.quoteId,
        workDate,
        paymentMethod: pay || null,
        paymentMemo: memo || null,
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
      className={`rounded-xl border bg-white ${
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
        className="w-full p-3 text-left lg:p-5"
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
            {s.paymentMethod ?? ""}
            {/* ⭐ MARS 표식 (사장님 지시 2026-08-09) — ✓ 올라감 · 올리는 중 = 체크 후 대기 */}
            {s.marsStatus === "전송완료" && <span className="ml-1.5 font-semibold text-indigo-600">MARS ✓</span>}
            {s.marsStatus === "미전송" && !canceled && (
              <span className="ml-1.5 text-amber-600">MARS 올리는 중</span>
            )}
          </span>
        </div>
        {/* PC: 품목을 줄별로 펼쳐서 — 펼치지 않아도 무엇을 얼마에 했는지 보인다 */}
        <div className="mt-2 hidden space-y-1 lg:block">
          {s.lines.map((l) => (
            <div key={l.itemId} className="flex items-baseline justify-between gap-3 text-sm text-slate-600">
              <span className="min-w-0 truncate">
                {l.lineType === "service" && <span className="mr-1 text-xs text-slate-400">공임</span>}
                {l.description}
                {l.spec && <span className="tabular ml-1 text-slate-500">{l.spec}</span>}
              </span>
              <span className="tabular shrink-0">
                {l.qty > 1 && `${l.qty} × `}
                {won(l.finalPrice)}원
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
          {!canceled && <AddLine quoteId={s.quoteId} onMessage={setNotice} />}

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
              {s.paymentMethod && ` · ${s.paymentMethod}`}
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
          </div>

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
                  <div className="flex flex-wrap gap-1.5">
                    {PAYS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPay(pay === p ? "" : p)}
                        className={`rounded-lg px-2.5 py-1.5 text-sm font-medium ${
                          pay === p ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
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
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 active:bg-slate-50"
                  >
                    날짜·결제 고치기
                  </button>
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
              </p>
            </>
          )}
        </div>
      )}
    </li>
  );
}
