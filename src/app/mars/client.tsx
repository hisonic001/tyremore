"use client";

import { useState, useTransition } from "react";
import { markEntered, removeFromQueue, unmarkEntered, type MarsEntry } from "@/lib/mars-queue";
import { AddLine, EditableLine } from "../sales/line-edit";

const won = (n: number) => n.toLocaleString();

/** 누르면 복사되는 칸 — MARS 로 옮겨 칠 때 오타가 나지 않게 */
function Copy({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  const [hit, setHit] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setHit(true);
          setTimeout(() => setHit(false), 900);
        });
      }}
      className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${wide ? "w-full" : ""} ${
        hit ? "border-emerald-600 bg-emerald-50" : "border-slate-300 bg-white active:bg-slate-100"
      }`}
    >
      <div className="text-[11px] leading-tight text-slate-500">
        {label} {hit && <span className="font-semibold text-emerald-700">복사됨</span>}
      </div>
      <div className="tabular truncate text-sm font-medium">{value}</div>
    </button>
  );
}

export function QueueList({ entries }: { entries: MarsEntry[] }) {
  return (
    <ul className="mt-4 space-y-4">
      {entries.map((e) => (
        <Entry key={e.quoteId} e={e} />
      ))}
    </ul>
  );
}

/*
 * 🔴 이 화면의 액션 뒤에는 router.refresh() 를 부르지 않는다 (2026-08-07 마비 사건).
 *    서버 액션이 revalidatePath("/mars") 로 이미 새 화면을 실어 보낸다 — 클라이언트가
 *    또 refresh 하면 같은 화면을 **두 번** 그리고, 연달아 누르면 앞선 렌더가 중단되며
 *    진행 중이던 DB 질의가 좀비로 남는다. 좀비 3개면 트랜잭션 풀러(자리 3개)가
 *    만석이 되어 사이트 전체가 「계속 로딩중」으로 마비됐다.
 */
function Entry({ e }: { e: MarsEntry }) {
  const [pending, start] = useTransition();
  const [refNo, setRefNo] = useState("");
  /** ⭐ 대기열에서 바로 품목 고치기 (사장님 요청 2026-08-05) — 정비 내역과 같은 수정 UI */
  const [editing, setEditing] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  return (
    <li className="rounded-2xl border-2 border-indigo-600 bg-indigo-50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-indigo-900">
          {e.quoteNo}
          {e.soldAt && <span className="ml-2 text-xs font-normal text-indigo-700">{e.soldAt}</span>}
        </h2>
        <span className="tabular font-bold text-indigo-900">{won(e.total)}원</span>
      </div>

      {/* ① 고객 — MARS 는 개인 손님을 「연락처」로 다룬다 (D-10) */}
      <div className="mt-2">
        <div className="text-xs font-semibold text-indigo-800">① 고객</div>
        <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Copy label="연락처 번호" value={e.contactNo} />
          <Copy label="이름" value={e.customerName} />
          <Copy label="전화" value={e.phone} />
          <Copy label="차량번호" value={e.plateNo} />
          <Copy label="차종" value={e.vehicleModel} />
        </div>
        {!e.contactNo && (
          <p className="mt-1 rounded-lg bg-amber-100 px-2 py-1.5 text-xs text-amber-900">
            {e.newCustomer && !e.newCustomer.consentSigned ? (
              <>
                🔴 <strong>MARS 에 아직 없는 손님인데 개인정보 동의 서명이 없습니다.</strong>
                <br />
                자동 입력을 돌려도 고객 등록은 하지 않습니다. 서명을 받으셨으면 고객 화면에서 표시해 주세요.
              </>
            ) : (
              <>⚠️ MARS 에 아직 없는 손님입니다 — 자동 입력이 고객·차량부터 만듭니다</>
            )}
          </p>
        )}
        {e.memo && <p className="mt-1 text-xs text-indigo-800">{e.memo}</p>}
      </div>

      {/* ② 업무 내용 — MARS 원본 이름으로 보여준다 */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <div className="text-xs font-semibold text-indigo-800">② 업무 내용</div>
          {/* ⭐ MARS 에 넣기 전에 여기서 바로 고친다 (사장님 요청 2026-08-05) */}
          <button
            type="button"
            onClick={() => {
              setEditing(!editing);
              setEditMsg(null);
            }}
            className="text-xs text-indigo-700 underline underline-offset-2"
          >
            {editing ? "고치기 닫기" : "품목 고치기"}
          </button>
        </div>

        {editing ? (
          <div className="mt-1 rounded-xl bg-white p-2">
            <ul className="space-y-1">
              {e.lines.map((l) => (
                <EditableLine
                  key={l.itemId}
                  line={{
                    itemId: l.itemId,
                    lineType: l.kind === "tire" ? "tire" : "service",
                    description: l.marsName,
                    qty: l.qty,
                    finalPrice: l.unitPrice,
                    memo: l.memo,
                    // MARS 원본 이름에는 규격이 이미 들어 있다 — 따로 안 단다
                    spec: null,
                    listPrice: l.listPrice,
                  }}
                  onMessage={setEditMsg}
                />
              ))}
            </ul>
            <AddLine quoteId={e.quoteId} onMessage={setEditMsg} />
            {editMsg && <p className="mt-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-700">{editMsg}</p>}
            <p className="mt-1.5 text-[11px] text-indigo-700">
              고치면 정비 내역·재고·합계가 같이 바뀝니다 — 아직 MARS 에 안 넣은 건이라 안전합니다.
            </p>
          </div>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {e.lines.map((l, i) => (
              <li key={i} className="rounded-lg bg-white p-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">
                    {l.kind === "tire" ? "상품" : "서비스"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug">{l.marsName}</div>
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                  <Copy label="품번" value={l.no} />
                  <Copy label="수량" value={String(l.qty)} />
                  <Copy label="단가" value={String(l.unitPrice)} />
                  <Copy label="금액" value={String(l.amount)} />
                </div>
                {/* ⭐ 줄별 메모 (사장님 지시 2026-08-07) — 이 줄의 「설명 2」에 들어간다 */}
                {l.memo && (
                  <div className="mt-1.5">
                    <Copy label="설명 2" value={l.memo} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ③ 결제 */}
      <div className="mt-3">
        <div className="text-xs font-semibold text-indigo-800">③ 결제</div>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          <Copy label="결제 방법" value={e.paymentMethod} />
          <Copy label="합계" value={String(e.total)} />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={refNo}
          onChange={(e2) => setRefNo(e2.target.value)}
          placeholder="MARS 주문번호 (선택)"
          className="tabular min-w-0 flex-1 rounded-lg border border-indigo-300 px-3 py-2.5 text-sm"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              // 자동 입력과 구분해 둔다 — 나중에 「어떻게 들어갔나」를 되짚을 수 있게
              await markEntered(e.quoteId, refNo, "손으로 입력");
            })
          }
          className="shrink-0 rounded-lg bg-indigo-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          입력 완료
        </button>
      </div>

      {/*
        ⭐ 대기열에서 빼기 (사장님 요청 2026-08-05).
           판매를 지우는 것이 아니다 — 「MARS 자동 입력 대상에서 제외」만 한다.
           판매 자체 취소(재고 복원)는 /sales 의 판매 취소가 한다.
      */}
      <div className="mt-2 flex items-center justify-between">
        <a href="/sales" className="text-xs text-indigo-700 underline underline-offset-2">
          판매 자체를 취소하려면 → 정비 내역
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`${e.quoteNo} 을(를) MARS 대기열에서 뺄까요?\n(MARS 에 자동으로 넣지 않습니다 — 판매 기록은 그대로 남습니다)`)) return;
            start(async () => {
              await removeFromQueue(e.quoteId);
            });
          }}
          className="text-xs text-slate-500 underline underline-offset-2"
        >
          대기열에서 빼기 (MARS 직접 처리)
        </button>
      </div>
    </li>
  );
}

export function DoneList({
  rows,
}: {
  rows: { quoteId: number; quoteNo: string; customerName: string | null; total: number; refNo: string | null; status: string }[];
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between font-semibold text-slate-600"
      >
        최근 입력 완료 {rows.length}건
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => (
            <li key={r.quoteId} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  {r.quoteNo} {r.customerName && `· ${r.customerName}`}
                  {r.status === "수동처리" && (
                    <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">직접 처리</span>
                  )}
                </div>
                {r.refNo && <div className="tabular text-xs text-slate-500">MARS {r.refNo}</div>}
              </div>
              <span className="tabular text-sm">{won(r.total)}원</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await unmarkEntered(r.quoteId);
                  })
                }
                className="shrink-0 text-xs text-slate-500 underline"
              >
                되돌리기
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
