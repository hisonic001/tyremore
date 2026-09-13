import { redirect } from "next/navigation";
import Link from "@/lib/link";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { weeklyExpenseStep } from "@/lib/weekly-expenses";
import { won } from "@/components/fin/money";
import { W } from "@/lib/fin-words";
import { ExpensesFlow } from "@/app/finance/weekly/steps/expenses-flow";

export const dynamic = "force-dynamic";

// 감사 L3: 달 계산은 lib/ym 정본

/**
 * ⭐ 지출 분류 (ERP ⑥, 사장님 지시 2026-08-25) — 사장님 전용
 *
 *   통장 출금·법인카드 지출을 임차료·인건비·공과금… 으로 나눈다.
 *   한 번 나누면 같은 상대는 자동 — 손익의 「비용」이 이걸로 완성된다.
 *   🔴 개편 5단계(2026-09-13): 몸통은 「이번 주 정리」 ④ 와 같은 3층(ExpensesFlow) — 옛 ExpensesUi 는 지웠다.
 *      「같은 상대 여러 건 — 한 번에」 칸은 흐름의 「확인해 주세요」 묶음이 같은 일을 하므로 같이 사라졌고,
 *      분류별 합계는 「자세히」 접힘으로 남긴다(어댑터가 expenseData 를 통째로 주므로 조회 추가 없음).
 */
export default async function FinanceExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  const step = await weeklyExpenseStep(ym);
  const { data } = step;
  const month = Number(ym.slice(5, 7));

  return (
    <FinShell tab="expenses" monthNav={{ ym, basePath: "/finance/expenses" }}>
      <p className="mt-2 text-sm text-slate-500">
        한 번 분류하면 같은 상대는 과거 것까지 한꺼번에, 앞으로 올리는 파일에도 자동으로 붙습니다.
      </p>

      <p className="tabular mt-4 text-sm">
        분류 안 된 지출 <strong>{data.unclassifiedCount}건 · {won(data.unclassifiedTotal)}원</strong>
        {data.unclassifiedCount > data.unclassified.length ? ` (금액 큰 ${data.unclassified.length}건부터 표시)` : ""}
      </p>

      {/* 🔴 「자료 없음」과 「다 됐다」를 가른다 (입금 화면과 같은 규칙) */}
      {data.unclassified.length === 0 && (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.monthOutCount === 0 ? (
            <>
              {month}월 통장·카드 내역이 아직 안 올라왔습니다 —{" "}
              <Link href={`/finance/upload?ym=${ym}`} className="underline">내역 올리기</Link>
            </>
          ) : (
            <>
              {month}월 지출은 모두 분류됐습니다 🎉 — 다음은{" "}
              <Link href={`/finance/tax?ym=${ym}`} className="font-semibold underline">{W.reconTax} →</Link>
            </>
          )}
        </section>
      )}

      {/* 3층 몸통 — 흐름 ④ 와 같은 조각 */}
      <ExpensesFlow step={step} />

      {/* 장부 성격 조각 — 접어 둔다. 분류가 끝난 뒤 「이 달 어디에 얼마 썼나」를 볼 때만 연다 */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-slate-500 underline underline-offset-2">
          {W.detail} — {W.expenseSums}
        </summary>
        {data.sums.length > 0 && (
          <ul className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {data.sums.map((s) => (
              <li key={s.category} className="flex justify-between">
                <span className="text-slate-600">{s.category}</span>
                <span>{won(s.amount)}원</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          매입대금·카드대금·내부이체로 분류한 지출은 손익의 「{W.cost}」에 다시 넣지 않습니다 — 매입·법인카드
          쪽에서 이미 세고 있어 이중 계산이 되기 때문입니다.
        </p>
        {/* ⭐ 개편 2단계(2026-09-12): 「분류된 지출 N건 — 해제」 접힌 표는 「최근 한 일」 한 곳으로(결정 f).
            해제(이 줄만/전부)는 거기서 되돌리기로 한다. */}
        <p className="mt-2 text-xs text-slate-400">
          잘못 분류한 지출{data.classified.length > 0 ? `(이 달 ${data.classified.length}건)` : ""}은{" "}
          <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
        </p>
      </details>

      <p className="mt-4 text-sm">
        {W.next}:{" "}
        <Link href={`/finance/tax?ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          {W.reconTax} →
        </Link>
      </p>
    </FinShell>
  );
}
