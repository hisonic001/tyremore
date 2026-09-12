/**
 * ⭐ 「이번 주 정리 끝 ✓」 (개편 3단계, 2026-09-12)
 *
 *   마지막 단계 아래 단추 하나. 누르면 app_setting.weekly_done_at 에 오늘을 적고 첫 화면으로 —
 *   첫 화면 「마지막 정리 M/D」가 이걸 읽는다. 남은 단계가 있어도 **막지 않는다**(되돌릴 게 없는
 *   날짜 기록이라 확인창도 없다). 「최근 한 일」에는 남기지 않는다 — 일이 아니라 리듬 표시다.
 */
import { markWeeklyDone } from "@/lib/weekly-done";
import type { WeeklyStep } from "@/lib/weekly-steps";
import { remainingSteps } from "@/lib/weekly-pure";
import { W } from "@/lib/fin-words";

export function DoneForm({ steps }: { steps: WeeklyStep[] }) {
  const left = remainingSteps(steps);
  return (
    <form action={markWeeklyDone} className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        {W.weeklyDone} ✓
      </button>
      {left > 0 ? (
        <span className="text-sm text-amber-800">🟡 아직 {left}단계 남음 — 그래도 끝낼 수 있습니다</span>
      ) : (
        <span className="text-sm text-slate-500">다 됐습니다. 첫 화면에 「{W.lastDone} 오늘」로 남습니다</span>
      )}
    </form>
  );
}
