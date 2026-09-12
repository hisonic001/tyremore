/**
 * ⭐ 「이번 주 정리」 한 줄 흐름 /finance/weekly?step=N (개편 3단계, 2026-09-12 — 사장님 결정 11)
 *
 *   첫 화면 「이번 주 정리」 칸의 [하기 →] 가 전엔 기존 화면 7개로 흩어져 나갔다(귀찮은 것 셋 중 「화면 이동」).
 *   이제 한 화면 안에서 단계를 넘긴다: ① 자료 → ② 카드 → ③ 입금 → ④ 지출 → ⑤ 계산서 → ⑥ 지급 → ⑦ 지난달 마감.
 *   단계 목록·상태·남은 수는 정본 weeklySteps 그대로(7단계, 사장님 확정). 각 단계는 3층(앱이 자동 / 확인 / 손).
 *
 * 🔴 한 요청에 **한 단계만** 조회한다 — 풀이 3이다. weeklySteps + 현재 단계 조회.
 * 🔴 PC 전용(결정 2 「정리는 PC, 폰은 보기만」) — 폰에는 안내 한 줄.
 * 🔴 「이 단계 끝 ✓ · 다음 →」은 링크일 뿐 서버에 안 남긴다. 마지막 「정리 끝 ✓」만 날짜를 적는다.
 */
import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { weeklySteps } from "@/lib/weekly-steps";
import { parseStep, stepMark } from "@/lib/weekly-pure";
import { FinShell } from "@/components/fin/shell";
import { W } from "@/lib/fin-words";
import { WeeklyProgress, WeeklyStepNav } from "./nav";
import { DoneForm } from "./done-form";
import { UploadStep } from "./steps/upload";
import { CardStep } from "./steps/card";
import { DepositsStep } from "./steps/deposits";
import { ExpensesStep } from "./steps/expenses";
import { TaxStep } from "./steps/tax";
import { PayablesStep } from "./steps/payables";
import { CloseStep } from "./steps/close";

export const dynamic = "force-dynamic";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const weekly = await weeklySteps(ym);
  const step = parseStep(sp.step, weekly.steps);
  const cur = weekly.steps.find((s) => s.no === step) ?? weekly.steps[weekly.steps.length - 1];

  return (
    <FinShell tab="weekly" monthNav={{ ym, basePath: "/finance/weekly", keep: { step: String(step) } }}>
      {/* 폰 — 보기만 (결정 2). 첫 화면 「이번 주 정리」 칸과 같은 문법(hidden lg:block) */}
      <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 lg:hidden">
        {W.pcOnly} —{" "}
        <Link href={`/finance?ym=${ym}`} className="underline underline-offset-2">
          현황으로 →
        </Link>
      </p>

      <div className="hidden lg:block">
        <h2 className="mt-3 flex flex-wrap items-baseline gap-x-2 text-lg font-bold">
          {W.weekly}
          <span className="text-slate-400">·</span>
          <span>
            {stepMark(cur.no)} {cur.title}
          </span>
          <span className="tabular text-sm font-normal text-slate-400">
            ({weekly.done}/{weekly.total} 끝)
          </span>
          <span className={`tabular text-sm font-normal ${cur.warn ? "text-amber-800" : "text-slate-500"}`}>{cur.status}</span>
        </h2>

        <WeeklyProgress steps={weekly.steps} current={step} ym={ym} />
        <WeeklyStepNav steps={weekly.steps} current={step} ym={ym} />

        {cur.key === "upload" && <UploadStep ym={ym} />}
        {cur.key === "card" && <CardStep ym={ym} status={cur.status} />}
        {cur.key === "deposits" && <DepositsStep ym={ym} />}
        {cur.key === "expenses" && <ExpensesStep ym={ym} />}
        {cur.key === "tax" && <TaxStep ym={ym} />}
        {cur.key === "payables" && <PayablesStep ym={ym} />}
        {cur.key === "close" && <CloseStep />}

        {cur.key === "close" ? <DoneForm steps={weekly.steps} /> : <WeeklyStepNav steps={weekly.steps} current={step} ym={ym} bottom />}
      </div>
    </FinShell>
  );
}
