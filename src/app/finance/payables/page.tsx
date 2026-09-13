import { redirect } from "next/navigation";
import Link from "@/lib/link";
import { getSession, hasPerm } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { weeklyPayableStep } from "@/lib/weekly-payables";
import { pickYm } from "@/lib/ym";
import { W } from "@/lib/fin-words";
import { PayablesFlow } from "@/app/finance/weekly/steps/payables-flow";

export const dynamic = "force-dynamic";

/**
 * ⭐ 미지급 장부 (ERP ⑦, 사장님 지시 2026-08-25) — 사장님 전용
 *
 *   거래처별로 「매입은 했는데 아직 안 준 돈」을 본다 — 외상 장부의 거울상.
 *   지급을 넣으면 오래된 매입부터 선입선출로 채워진다.
 *   🔴 개편 5단계(2026-09-13): 몸통은 「이번 주 정리」 ⑥ 과 같은 3층(PayablesFlow) — 옛 PayablesUi 는 지웠다.
 *      조회 5개(payablesData·payLinkData·payablesCardInfo·bankPayerOptions·taxCashData)가 어댑터 한 번으로.
 *      거래처 카드는 「거래처별 자세히」 접힘으로(withCards) — ⚡낱건·별명 관리·계산서 안내 박스는 뺐다(사장님 결정).
 */
export default async function FinancePayablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  // 🔴 2025 감사 F18: 이번 달 고정 → 보는 달 (MonthNav) — 2025 달의 출금도 지급 잡기에 나온다
  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const step = await weeklyPayableStep(ym);
  // 🔴 2단계(2026-09-12): links.skipped·links.linked(되돌리기 표 2개)는 「최근 한 일」로 옮겨 안 넘긴다

  return (
    <FinShell tab="payables" monthNav={{ ym, basePath: "/finance/payables" }}>
      <p className="mt-2 text-sm text-slate-500">
        {W.payable}의 정본은 <strong>세금계산서 ↔ 통장 출금</strong>입니다 — 아래 앱 매입 장부는 보조 참고예요.
      </p>
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer underline underline-offset-2">{W.detail}</summary>
        <p className="mt-1">
          계산서가 출금으로 확인되면 그 매입은 준 것입니다. 앱 매입 장부는 앱에서 입고한 인보이스 기준이라 처음엔
          전부 「안 준 돈」으로 보이는 게 정상 — 「출금에서 {W.reconPay}」로 보는 달의 매입대금 출금을 {W.recon}해 주면 장부가
          실제와 같아집니다. 잘못 {W.recon}했으면 「{W.activity}」에서 언제든 되돌립니다.
        </p>
      </details>

      {/* 빈 상태 — 미지급 잔액이 있는 거래처가 하나도 없을 때(옛 카드 목록의 빈 상태 그대로) */}
      {step.suppliers.length === 0 && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          미지급 잔액이 없습니다 🎉
        </section>
      )}

      {/* 3층 몸통 — 흐름 ⑥ 과 같은 조각 + 거래처 카드 접힘 */}
      <PayablesFlow step={step} withCards />

      {/* ⭐ 개편 2단계(2026-09-12) — 「출금에서 대조한 지급」·「최근 지급 기록」·「접어둔 출금」의
          되돌리기 표 3개는 「최근 한 일」 한 곳으로(결정 f). 여기엔 링크 한 줄만. */}
      <p className="mt-4 text-xs text-slate-400">
        잘못 {W.recon}한 지급·잘못 접은 출금은{" "}
        <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
      </p>
      <p className="mt-2 text-sm">
        {W.next}:{" "}
        <Link href={`/finance/weekly?step=7&ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          지난달 마감 →
        </Link>
      </p>
    </FinShell>
  );
}
