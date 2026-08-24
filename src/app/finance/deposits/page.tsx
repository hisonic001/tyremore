import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { depositReconData } from "@/lib/recon-data";
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

  const data = await depositReconData(ym);

  return (
    <FinShell tab="deposits" monthNav={{ ym, basePath: "/finance/deposits" }}>
      <DepositsRecon data={data} ym={ym} />
    </FinShell>
  );
}
