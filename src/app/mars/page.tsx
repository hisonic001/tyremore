import Link from "next/link";
import { marsDone, marsQueue } from "@/lib/mars-queue";
import { DoneList, QueueList } from "./client";

export const dynamic = "force-dynamic";

/**
 * MARS 입력 대기열 — 「매출 주문」에 칠 것을 칠 순서대로 보여준다.
 * 🔴 전기(Posting)는 사람이 누른다. 자동화하지 않는다 (D-08).
 */
export default async function MarsPage() {
  const [queue, done] = await Promise.all([marsQueue(), marsDone()]);
  const total = queue.reduce((s, q) => s + q.total, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <Link href="/sale" className="text-sm font-medium text-emerald-700 underline underline-offset-4">
          판매 등록 →
        </Link>
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
            ⭐ 자동 입력이 있다는 것을 여기서 알려 준다 (2026-08-02).
               이게 없어서 사장님이 손으로 치지도 않고 「입력 완료」를 누르셨다.
          */}
          <div className="mt-3 rounded-xl border border-indigo-300 bg-indigo-50 p-3">
            <div className="text-sm font-semibold text-indigo-900">자동으로 넣으시려면</div>
            <p className="mt-1 text-xs text-indigo-800">
              PC 에서 아래를 실행하면 MARS 매출 주문까지 대신 채웁니다. 전기는 사장님이 누르십니다.
            </p>
            <code className="tabular mt-1.5 block rounded-lg bg-white px-3 py-2 text-sm">
              npm run mars -- --limit 1
            </code>
            <p className="mt-1.5 text-xs text-indigo-700">
              끝나면 여기 목록에서 저절로 내려갑니다 —{" "}
              <strong>손으로 치셨을 때만 「입력 완료」를 누르세요.</strong>
            </p>
          </div>

          <QueueList entries={queue} />
        </>
      )}

      <DoneList rows={done} />

      <p className="mt-8 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
        <strong>전기(Posting)는 사람이 누릅니다.</strong> 이 화면은 무엇을 어떤 순서로 칠지 보여줄 뿐,
        MARS 를 대신 조작하지 않습니다. 잘못 전기하면 되돌리는 것이 우리 손을 떠나기 때문입니다.
      </p>
    </main>
  );
}
