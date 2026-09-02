import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
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
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  const data = await expenseData(ym);

  return (
    <FinShell tab="expenses" monthNav={{ ym, basePath: "/finance/expenses" }}>
      <p className="mt-2 text-sm text-slate-500">
        한 번 분류하면 같은 상대는 과거 것까지 한꺼번에, 앞으로 올리는 파일에도 자동으로 붙습니다.
      </p>
      <ExpensesUi data={data} ym={ym} />
    </FinShell>
  );
}
