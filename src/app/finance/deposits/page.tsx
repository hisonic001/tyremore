import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { weeklyDepositStep } from "@/lib/weekly-deposits";
import { W } from "@/lib/fin-words";
import { DepositsRecon } from "./deposits-ui";

export const dynamic = "force-dynamic";

// 감사 L3: 달 계산은 lib/ym 정본

/**
 * ⭐ 통장 입금 대조 (ERP 4단계, 2026-08-24) — 사장님 전용
 *
 *   통장에 들어온 돈이 무엇인지 정리한다: 카드 정산 / 계좌이체 판매 / 미수금 수금.
 *   수금은 여기서 바로 등록된다 (선입선출 — 미수금 장부의 정산 로직 그대로).
 */
export default async function FinanceDepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  /* ⭐ 3단계(2026-09-12): 조립(depositReconData → depositTaxCandidates → depositSurePicks → arrangeDeposits
     + transferSalesMissing)은 weekly-deposits.ts 로 옮겼다 — 「이번 주 정리」 흐름과 이 화면이 같은 것을 쓴다.
     프롭·모양은 그대로(sureIds = depositSurePicks 키). */
  const step = await weeklyDepositStep(ym);
  /* 🔴 2단계(2026-09-12): 「통장 밖」으로 정리한 판매의 되돌리기 목록(asideMarkedSales)은
     「최근 한 일」(/finance/activity)로 옮겼다 — 이 화면엔 링크 한 줄만 (결정 f). */

  return (
    <FinShell tab="deposits" monthNav={{ ym, basePath: "/finance/deposits" }}>
      <p className="mt-2 text-sm text-slate-500">
        통장에 들어온 돈이 무엇인지 {W.recon}합니다 — 카드 정산 · 세금계산서 대금 · 판매 · {W.receivable} 수금 · 판매와 무관(이자·지원금·환불).
        짝이 확실한 것은 한 번에, 나머지는 카드마다 고르면 됩니다.
      </p>
      <DepositsRecon
        data={step.data}
        ym={ym}
        taxCands={step.taxCands}
        bundles={step.bundles}
        sureIds={step.sure}
        breakdown={step.breakdown}
        transfers={step.transfers}
      />
    </FinShell>
  );
}
