"use client";

/**
 * ⭐ ④ 지출 분류 — 3층 화면 (개편 3단계, 2026-09-12)
 *
 *   「앱이 자동 분류한 것」(접힘) → 「확인해 주세요」(같은 상대 묶음, 체크 기본 ON —
 *   묶음마다 setExpenseCategory(anyId, suggest) **한 번**, 액션이 같은 상대에 전파하고 한 줄 남긴다)
 *   → 「손이 필요한 것」(제안 없는 줄 — 단서 + 분류 고르기, expenses-ui 의 ExpenseRowCard 그대로).
 *   🔴 새 액션·새 판정 없음.
 */
import type { WeeklyExpenseStep } from "@/lib/weekly-types";
import { setExpenseCategory } from "@/lib/fin-expense";
import { W } from "@/lib/fin-words";
import { won } from "@/components/fin/money";
import { AutoTier, CheckRunList, TierHead } from "@/components/fin/check-run-list";
import { ExpenseBanner, ExpenseRowCard, useExpenseCtx } from "@/app/finance/expenses/expenses-ui";

export function ExpensesFlow({ step }: { step: WeeklyExpenseStep }) {
  const ctx = useExpenseCtx();

  return (
    <div className="mt-2">
      <ExpenseBanner ctx={ctx} />

      {/* 1층 — 앱이 자동 분류한 것 (접힘) */}
      <AutoTier lines={step.auto} />

      {/* 2층 — 확인해 주세요: 묶음 = 액션 한 번 (두 번 부르면 두 줄 기록) */}
      <CheckRunList
        title={
          <>
            🟡 {W.tierCheck} <span className="tabular">{step.check.length}</span>묶음 — 체크해서 한 번에
          </>
        }
        hint="앱이 규칙으로 분류를 제안한 상대입니다. 맞으면 그대로, 아니면 체크를 끄고 아래에서 직접 고르세요. 한 상대를 붙이면 같은 상대의 다른 줄에도 같이 붙습니다."
        items={step.check.map((g) => ({
          key: g.key,
          text: (
            <>
              <span className="font-medium">{g.payer}</span>{" "}
              <span className="tabular text-xs text-slate-500">{g.n}건</span> ·{" "}
              <span className="tabular font-bold text-red-600">−{won(g.sum)}원</span>
            </>
          ),
          sub: `→ ${g.suggest}`,
          run: () => setExpenseCategory(g.anyId, g.suggest),
          errLabel: `${g.payer} ${won(g.sum)}`,
        }))}
        buttonLabel={(n) => `체크한 ${n}묶음 분류`}
        unit="묶음"
        verb="분류"
        pending={ctx.pending}
      />

      {/* 3층 — 손이 필요한 것 */}
      <TierHead title={W.tierHand} n={step.hand.length} />
      {step.hand.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-start">
          {step.hand.map((row) => (
            <ExpenseRowCard key={row.id} row={row} ctx={ctx} />
          ))}
        </ul>
      )}
    </div>
  );
}
