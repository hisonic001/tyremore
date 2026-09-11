import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { depositReconData } from "@/lib/recon-data";
import { arrangeDeposits, depositSurePicks, depositTaxCandidates, transferSalesMissing } from "@/lib/deposit-tax";
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

  const raw = await depositReconData(ym);
  // ⭐ 2026-08-26: 계산서 후보를 이 화면에서 바로 — 짝 확실 → 짝 있음 → 없음 순으로
  const { cands: taxCands, bundles } = await depositTaxCandidates(
    ym,
    raw.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sure = depositSurePicks(raw.open, taxCands, bundles);
  const { open, breakdown } = arrangeDeposits(raw.open, taxCands, sure, bundles);
  const data = { ...raw, open };
  // ⭐ 계좌이체로 적혔는데 법인 통장에 없는 판매 (개인 통장 입금 등, 사장님 제보 2026-08-26)
  const transfers = await transferSalesMissing(ym);
  /* 🔴 2단계(2026-09-12): 「통장 밖」으로 정리한 판매의 되돌리기 목록(asideMarkedSales)은
     「최근 한 일」(/finance/activity)로 옮겼다 — 이 화면엔 링크 한 줄만 (결정 f). */

  return (
    <FinShell tab="deposits" monthNav={{ ym, basePath: "/finance/deposits" }}>
      <p className="mt-2 text-sm text-slate-500">
        통장에 들어온 돈이 무엇인지 {W.recon}합니다 — 카드 정산 · 세금계산서 대금 · 판매 · {W.receivable} 수금 · 판매와 무관(이자·지원금·환불).
        짝이 확실한 것은 한 번에, 나머지는 카드마다 고르면 됩니다.
      </p>
      <DepositsRecon data={data} ym={ym} taxCands={taxCands} bundles={bundles} sureIds={[...sure.keys()]} breakdown={breakdown} transfers={transfers} />
    </FinShell>
  );
}
