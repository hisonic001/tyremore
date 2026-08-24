import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { kstToday, ymAdd } from "@/lib/ym";
import { expenseData } from "@/lib/recon-data";
import { ExpensesUi } from "./expenses-ui";

export const dynamic = "force-dynamic";

// 감사 L3: 달 계산은 lib/ym 정본

/**
 * ⭐ 지출 분류 (ERP ⑥, 사장님 지시 2026-08-25) — 사장님 전용
 *
 *   통장 출금·법인카드 지출을 임차료·인건비·공과금… 으로 나눈다.
 *   한 번 나누면 같은 상대는 자동 — 손익의 「쓴 돈」이 이걸로 완성된다.
 */
export default async function FinanceExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const thisYm = kstToday().slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;

  const data = await expenseData(ym);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">지출 분류</h1>
        <Link href="/finance" className="text-sm text-slate-600 underline underline-offset-4">
          ← 돈 관리로
        </Link>
      </header>
      <p className="text-sm text-slate-500">
        한 번 분류하면 같은 상대는 과거 것까지 한꺼번에, 앞으로 올리는 파일에도 자동으로 붙습니다.
      </p>

      <nav className="tabular mt-2 flex items-center justify-center gap-4 text-sm">
        <Link href={`/finance/expenses?ym=${ymAdd(ym, -1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
          ◀ {ymAdd(ym, -1)}
        </Link>
        <span className="font-bold">{ym}</span>
        {ym < thisYm ? (
          <Link href={`/finance/expenses?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
            {ymAdd(ym, 1)} ▶
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-slate-300">다음 달</span>
        )}
      </nav>

      <ExpensesUi data={data} />
    </main>
  );
}
