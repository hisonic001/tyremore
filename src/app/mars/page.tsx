import Link from "next/link";
import { marsDone, marsQueue } from "@/lib/mars-queue";
import { latestMarsRun } from "@/lib/mars-run";
import { DoneList, QueueList } from "./client";
import { MarsRunPanel } from "./run-button";

export const dynamic = "force-dynamic";

/**
 * MARS 입력 대기열 — 「매출 주문」에 칠 것을 칠 순서대로 보여준다.
 * ⭐ 전기(Posting)까지 자동이다 (사장님 결정 2026-08-04 — "전기까지 원스톱").
 * 🔴 단, 합계 대조가 일치할 때만 전기한다. 어긋나면 초안으로 남기고 사람이 본다.
 */
export default async function MarsPage() {
  const [queue, done, run] = await Promise.all([marsQueue(), marsDone(), latestMarsRun()]);
  const total = queue.reduce((s, q) => s + q.total, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <div className="flex gap-3">
          <Link href="/sales" className="text-sm font-medium text-slate-600 underline underline-offset-4">
            정비 내역
          </Link>
          <Link href="/sale" className="text-sm font-medium text-emerald-700 underline underline-offset-4">
            판매 등록 →
          </Link>
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-bold">
        MARS 입력 대기열
        {queue.length > 0 && (
          <span className="tabular ml-2 rounded-full bg-indigo-100 px-2.5 py-0.5 align-middle text-base font-bold text-indigo-900">
            {queue.length}건
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        MARS 「매출 주문」에 칠 순서대로 나옵니다. 칸을 누르면 복사됩니다.
      </p>

      {queue.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          칠 것이 없습니다
        </p>
      ) : (
        <>
          <p className="tabular mt-3 text-sm text-slate-600">합계 {total.toLocaleString()}원</p>

          {/*
            ⭐ 콘솔 명령 대신 버튼 (사장님 요청 2026-08-04).
               "npm 으로 시작하는 콘솔 명령어라는 점이 불편함."
               실행은 매장 PC 의 대리인(mars-agent)이 한다 — 스키마 mars_run 주석 참조.
          */}
          <MarsRunPanel run={run} queueCount={queue.length} />

          <QueueList entries={queue} />
        </>
      )}

      <DoneList rows={done} />

      <p className="mt-8 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
        <strong>금액이 맞을 때만 전기까지 자동입니다.</strong> 합계가 어긋난 건은 초안으로 남기고 알려 드립니다 —
        MARS 를 대신 조작하지 않습니다. 잘못 전기하면 되돌리는 것이 우리 손을 떠나기 때문입니다.
      </p>
    </main>
  );
}
