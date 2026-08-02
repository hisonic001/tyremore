"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markEntered, unmarkEntered, type MarsEntry } from "@/lib/mars-queue";

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

function Entry({ e }: { e: MarsEntry }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [refNo, setRefNo] = useState("");

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
        <div className="text-xs font-semibold text-indigo-800">② 업무 내용</div>
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
            </li>
          ))}
        </ul>
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
              await markEntered(e.quoteId, refNo);
              router.refresh();
            })
          }
          className="shrink-0 rounded-lg bg-indigo-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          입력 완료
        </button>
      </div>
    </li>
  );
}

export function DoneList({
  rows,
}: {
  rows: { quoteId: number; quoteNo: string; customerName: string | null; total: number; refNo: string | null }[];
}) {
  const router = useRouter();
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
                    router.refresh();
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
