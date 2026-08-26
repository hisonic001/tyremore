import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { depositReconData } from "@/lib/recon-data";
import { arrangeDeposits, depositSurePicks, depositTaxCandidates } from "@/lib/deposit-tax";
import { DepositsRecon } from "./deposits-ui";

export const dynamic = "force-dynamic";

// 감사 L3: 달 계산은 lib/ym 정본

/**
 * ⭐ 통장 입금 대조 (ERP 4단계, 2026-08-24) — 사장님 전용
 *
 *   통장에 들어온 돈이 무엇인지 정리한다: 카드 정산 / 계좌이체 판매 / 외상 수금.
 *   외상 수금은 여기서 바로 등록된다 (선입선출 — 외상 장부의 정산 로직 그대로).
 */
export default async function FinanceDepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  const raw = await depositReconData(ym);
  // ⭐ 2026-08-26: 계산서 후보를 이 화면에서 바로 — 짝 확실 → 짝 있음 → 없음 순으로
  const taxCands = await depositTaxCandidates(
    ym,
    raw.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sure = depositSurePicks(raw.open, taxCands);
  const { open, breakdown } = arrangeDeposits(raw.open, taxCands, sure);
  const data = { ...raw, open };

  return (
    <FinShell tab="deposits" monthNav={{ ym, basePath: "/finance/deposits" }}>
      <p className="mt-2 text-sm text-slate-500">
        통장에 들어온 돈이 무엇인지 정리합니다 — 카드 정산 · 세금계산서 대금 · 판매 · 외상 수금 · 판매와 무관(이자·지원금·환불).
        짝이 확실한 것은 한 번에, 나머지는 카드마다 고르면 됩니다.
      </p>
      <DepositsRecon data={data} ym={ym} taxCands={taxCands} sureIds={[...sure.keys()]} breakdown={breakdown} />
    </FinShell>
  );
}
