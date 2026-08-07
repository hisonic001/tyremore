"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelMarsRun, requestMarsRun, type MarsRunRow } from "@/lib/mars-run";

/**
 * ⭐ 「자동으로 넣기」 버튼 (사장님 요청 2026-08-04)
 *
 *   "npm 으로 시작하는 콘솔 명령어라는 점이 불편함. 웹페이지에 버튼이라도."
 *
 * 버튼은 요청을 남기고, 실행은 매장 PC 의 대리인(mars-agent)이 한다.
 * 돌아가는 동안 이 화면이 5초마다 새로고침하며 진행 로그를 보여준다.
 */
export function MarsRunPanel({ run, queueCount }: { run: MarsRunRow | null; queueCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = run !== null && (run.status === "대기" || run.status === "실행중");

  /**
   * 대기·실행중이면 5초마다 다시 불러온다 — 로그가 자라는 것이 보인다.
   *
   * 🔴 앞선 새로고침이 **끝나기 전에는 다음 것을 쏘지 않는다** (2026-08-07 마비 사건).
   *    겹쳐 쏘면 진행 중이던 렌더가 중단되고, 그 렌더의 DB 질의가 좀비로 남아
   *    트랜잭션 풀러(자리 3개)를 채워 사이트 전체가 마비됐다.
   *    탭이 안 보일 때(다른 창 보는 중)도 쉰다 — 몰래 쌓일 이유가 없다.
   */
  const [refreshing, startRefresh] = useTransition();
  const refreshingRef = useRef(false);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (document.hidden || refreshingRef.current) return;
      startRefresh(() => router.refresh());
    }, 5000);
    return () => clearInterval(t);
  }, [busy, router]);

  function request() {
    start(async () => {
      setError(null);
      const r = await requestMarsRun("입력");
      if (!r.ok) return setError(r.error);
      // requestMarsRun 이 revalidatePath("/mars") 로 화면을 새로 실어 보낸다 — 중복 refresh 금지
    });
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-300 bg-indigo-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-indigo-900">MARS 자동 입력</div>
        {busy && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-700">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
            {run.status === "대기" ? "매장 PC 를 기다리는 중" : "실행 중"}
          </span>
        )}
      </div>

      {!busy && (
        <>
          <p className="mt-1 text-xs text-indigo-800">
            누르면 매장 PC 가 <strong>매출 주문 → 전기 → 차량 점검까지</strong> 한 번에 처리합니다. 금액이 안 맞으면 전기 앞에서 멈추고 알려 드립니다.
          </p>
          <button
            type="button"
            disabled={pending || queueCount === 0}
            onClick={request}
            className="mt-2 w-full rounded-xl bg-indigo-700 py-3 font-semibold text-white active:bg-indigo-800 disabled:opacity-40"
          >
            {queueCount === 0 ? "칠 것이 없습니다" : `지금 자동으로 넣기 (${queueCount}건)`}
          </button>
        </>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {run && (busy || run.status === "실패" || isRecent(run)) && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between text-xs text-indigo-700">
            <span>
              {run.status === "완료" && `✅ 끝났습니다 (${run.finishedAt})`}
              {run.status === "실패" && `⚠️ 실패했습니다 (${run.finishedAt ?? ""})`}
              {run.status === "실행중" && `${run.startedAt} 시작`}
              {run.status === "대기" && `${run.requestedAt} 요청됨`}
            </span>
            {busy && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await cancelMarsRun(run.id);
                    if (!r.ok) setError(r.error);
                  })
                }
                className="underline underline-offset-2"
              >
                중단 처리
              </button>
            )}
          </div>
          {run.log && (
            <pre className="tabular mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2 text-xs leading-relaxed text-slate-700">
              {run.log.split("\n").slice(-30).join("\n")}
            </pre>
          )}
          {run.status === "대기" && (
            <p className="mt-1.5 text-xs text-indigo-700">
              1분이 지나도 시작하지 않으면 매장 PC 의 대리인이 꺼진 것입니다 — PC 에서{" "}
              <code className="rounded bg-white px-1">mars-agent</code> 창을 열어 주세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** 끝난 지 10분 안이면 결과를 계속 보여준다 — 새로고침하다 끝난 순간을 놓칠 수 있다 */
function isRecent(run: MarsRunRow): boolean {
  return run.status === "완료" && run.finishedAt !== null;
}
