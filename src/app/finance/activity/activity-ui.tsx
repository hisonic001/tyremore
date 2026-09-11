"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityDay, ActivityRow, ActivityVerb } from "@/lib/fin-activity-types";
import { undoActivity } from "@/lib/fin-activity-actions";
import { W, verbWord } from "@/lib/fin-words";
import { won } from "@/components/fin/money";
import { StatusPill } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";

/**
 * ⭐ 최근 한 일 목록 (개편 2단계) — 한 줄 = 시각 · 누가 · verb 배지(글자는 fin-words 정본) · label · 금액 · [되돌리기]/「되돌림 ✓」
 *   일괄(n>1)은 「N건 ▾」 로 접고 펼치면 건별 되돌리기(2단계 결정 d — 375줄 폭발 방지).
 *   부품은 ui 정본(StatusPill·EmptyState·Notice·useConfirm) — 새 배지·배너 스타일 없음.
 *   폰 폭(390px): flex-wrap + min-w-0, 가로 스크롤 없음.
 */

/** verb → 배지 색 (StatusPill 의 기존 tone 만) */
const VERB_TONE: Record<ActivityVerb, "success" | "warn" | "error" | "info" | "neutral" | "accent" | "reserve"> = {
  대사: "success",
  되돌리기: "neutral",
  분류: "info",
  규칙: "info",
  보류: "warn",
  제외: "neutral",
  수금: "success",
  지급: "success",
  마감: "accent",
  올리기: "info",
  수정: "warn",
};

function dayTitle(d: string): string {
  const [y, m, dd] = d.split("-");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${d}T00:00:00+09:00`).getDay()];
  return `${y}.${Number(m)}.${Number(dd)} (${dow})`;
}

export function ActivityList({ days }: { days: ActivityDay[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const undo = async (row: ActivityRow, itemIndex?: number, label?: string) => {
    const what = label ?? row.label;
    if (
      !(await ask({
        title: `${W.undo}할까요?`,
        body: `${what}\n\n원래 화면에서 되돌리는 것과 같은 결과입니다.`,
        confirmLabel: W.undo,
        tone: "danger",
      }))
    )
      return;
    setError(null);
    const key = `${row.id}:${itemIndex ?? ""}`;
    setBusyId(key);
    start(async () => {
      const r = await undoActivity(row.id, itemIndex);
      setBusyId(null);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  };

  if (days.length === 0) {
    return (
      <>
        <EmptyState emoji="📝" title="아직 기록이 없습니다 — 오늘부터 남깁니다" hint="입금·계산서·지출·미지급에서 한 일과 앱이 자동으로 한 일이 여기에 쌓입니다." />
        {confirmDialog}
      </>
    );
  }

  const undoBtn = "shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 disabled:opacity-50";
  const undoneMark = <span className="shrink-0 text-xs text-slate-400">{W.undone} ✓</span>;

  return (
    <div className="mt-3">
      {error && <Notice tone="error">{error}</Notice>}
      {days.map((day) => (
        <section key={day.d} className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
          <h2 className="tabular text-sm font-semibold text-slate-700">{dayTitle(day.d)}</h2>
          <ul className="mt-1 divide-y divide-slate-100">
            {day.rows.map((row) => {
              const undone = !!row.undoneAt;
              const canUndo = !!row.undoKind && !undone;
              const bulk = row.undoKind === "bulk" && row.undoItems && row.undoItems.length > 0;
              const key = `${row.id}:`;
              return (
                <li key={row.id} className={`py-1.5 text-sm ${undone ? "text-slate-400" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="tabular shrink-0 text-xs text-slate-400">{row.atLabel.slice(6)}</span>
                    <span className="shrink-0 text-xs font-medium text-slate-500">{row.how === "사람" ? (row.actorName ?? "직원") : "앱"}</span>
                    <StatusPill tone={undone ? "neutral" : VERB_TONE[row.verb] ?? "neutral"}>{verbWord(row.verb)}</StatusPill>
                    {row.afterClose && <StatusPill tone="warn">마감 뒤</StatusPill>}
                    <span className={`min-w-0 flex-1 basis-40 break-words ${undone ? "line-through decoration-slate-300" : ""}`}>
                      {row.label}
                      {row.n > 1 && !bulk && <span className="ml-1 text-xs text-slate-400">{row.n}건</span>}
                    </span>
                    {row.amount != null && row.amount !== 0 && (
                      <span className="tabular shrink-0 font-semibold">{won(row.amount)}원</span>
                    )}
                    {undone ? (
                      undoneMark
                    ) : bulk ? null : canUndo ? (
                      <button type="button" disabled={pending && busyId === key} onClick={() => undo(row)} className={undoBtn}>
                        {W.undo}
                      </button>
                    ) : null}
                  </div>

                  {/* 일괄 — 「N건 ▾」 펼치면 건별 되돌리기 */}
                  {bulk && (
                    <details className="mt-0.5 pl-1">
                      <summary className="cursor-pointer text-xs text-slate-500">
                        {row.undoItems!.length}건 ▾
                        {!undone && (
                          <button
                            type="button"
                            disabled={pending && busyId === key}
                            onClick={(e) => {
                              e.preventDefault();
                              undo(row, undefined, `${row.label} — 남은 것 전부`);
                            }}
                            className={`ml-2 ${undoBtn}`}
                          >
                            남은 것 전부 {W.undo}
                          </button>
                        )}
                      </summary>
                      <ul className="mt-1 divide-y divide-slate-50 pl-2">
                        {row.undoItems!.map((it, i) => {
                          const itemDone = !!it.undone;
                          const ikey = `${row.id}:${i}`;
                          return (
                            <li key={i} className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-xs ${itemDone ? "text-slate-400" : "text-slate-700"}`}>
                              <span className={`min-w-0 flex-1 basis-40 break-words ${itemDone ? "line-through decoration-slate-300" : ""}`}>{it.label}</span>
                              {it.amount != null && it.amount !== 0 && <span className="tabular shrink-0 font-semibold">{won(it.amount)}원</span>}
                              {itemDone ? (
                                undoneMark
                              ) : (
                                <button type="button" disabled={pending && busyId === ikey} onClick={() => undo(row, i, it.label)} className={undoBtn}>
                                  {W.undo}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {confirmDialog}
    </div>
  );
}
