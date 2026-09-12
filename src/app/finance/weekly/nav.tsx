/**
 * ⭐ 「이번 주 정리」 진행막대·이전/다음 (개편 3단계, 2026-09-12 — 사장님 결정 11 「한 줄 흐름」)
 *
 *   ●━━●━━◉━━○━━○━━○━━○  끝=초록 ● · 현재=테두리 ◉ · 할 것=앰버 ○ · 때 아님=회색 ○
 *   칸마다 링크라 아무 단계나 바로 갈 수 있다 — 마법사처럼 순서를 강제하지 않는다.
 *   「이 단계 끝 ✓ · 다음 →」은 **단순 링크** — 서버에 아무것도 남기지 않는다(새 verb 금지).
 *   마지막 단계의 「이번 주 정리 끝 ✓」만 done-form 이 날짜를 기록한다.
 *
 *   서버 컴포넌트 — 훅 없음. 글자는 fin-words.ts 의 W.
 */
import Link from "@/lib/link";
import type { WeeklyStep } from "@/lib/weekly-steps";
import { stepMark } from "@/lib/weekly-pure";
import { W } from "@/lib/fin-words";

const hrefOf = (ym: string, no: number) => `/finance/weekly?step=${no}&ym=${ym}`;

export function WeeklyProgress({ steps, current, ym }: { steps: WeeklyStep[]; current: number; ym: string }) {
  return (
    <ol className="mt-3 flex items-start">
      {steps.map((s, i) => {
        const done = !s.warn && !s.idle;
        const isCur = s.no === current;
        const dot = isCur
          ? "border-2 border-brand-600 bg-white text-brand-700 ring-4 ring-brand-100"
          : done
            ? "border border-emerald-500 bg-emerald-500 text-white"
            : s.idle
              ? "border border-slate-300 bg-white text-slate-400"
              : "border border-amber-400 bg-amber-50 text-amber-800";
        return (
          <li key={s.key} className="flex flex-1 items-start">
            <Link href={hrefOf(ym, s.no)} className="flex w-14 shrink-0 flex-col items-center gap-1" aria-current={isCur ? "step" : undefined}>
              <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${dot}`}>{done && !isCur ? "✓" : s.no}</span>
              <span className={`text-center text-[11px] leading-tight ${isCur ? "font-semibold text-slate-900" : "text-slate-500"}`}>{s.title}</span>
            </Link>
            {i < steps.length - 1 && <span className={`mt-3.5 h-0.5 flex-1 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function WeeklyStepNav({
  steps,
  current,
  ym,
  bottom = false,
}: {
  steps: WeeklyStep[];
  current: number;
  ym: string;
  /** 단계 아래쪽 — 오른쪽이 「이 단계 끝 ✓ · 다음 →」 주 버튼 */
  bottom?: boolean;
}) {
  const prev = steps.find((s) => s.no === current - 1) ?? null;
  const next = steps.find((s) => s.no === current + 1) ?? null;
  const link = "rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";
  return (
    <div className={`flex items-center justify-between gap-2 ${bottom ? "mt-6 border-t border-slate-100 pt-4" : "mt-3"}`}>
      {prev ? (
        <Link href={hrefOf(ym, prev.no)} className={link}>
          ← {stepMark(prev.no)} {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        bottom ? (
          <Link href={hrefOf(ym, next.no)} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            {W.stepDone} ✓ · {W.next} →
          </Link>
        ) : (
          <Link href={hrefOf(ym, next.no)} className={link}>
            {stepMark(next.no)} {next.title} →
          </Link>
        )
      ) : (
        <span />
      )}
    </div>
  );
}
