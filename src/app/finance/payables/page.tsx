import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { payLinkData, payablesData } from "@/lib/recon-data";
import { taxCashData } from "@/lib/tax-recon";
import { kstToday } from "@/lib/ym";
import { PayablesUi } from "./payables-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 미지급 장부 (ERP ⑦, 사장님 지시 2026-08-25) — 사장님 전용
 *
 *   거래처별로 「매입은 했는데 아직 안 준 돈」을 본다 — 외상 장부의 거울상.
 *   지급을 넣으면 오래된 매입부터 선입선출로 채워진다.
 */
export default async function FinancePayablesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const data = await payablesData();
  const links = await payLinkData();
  // ⭐ 재설계(2026-08-25): 계산서 돈 확인의 정본은 /finance/tax 「돈 확인」 뷰 — 여기는 요약만
  const cash = await taxCashData("매입", kstToday().slice(0, 7));

  return (
    <FinShell tab="payables">
      <p className="mt-2 text-sm text-slate-500">
        ⭐ 정본은 <strong>세금계산서 ↔ 통장 출금</strong>입니다 (사장님 방침 2026-08-25) — 계산서가
        출금으로 확인되면 그 매입은 준 것입니다. 아래 앱 매입 장부는 보조 참고입니다. 이미 다 준 매입이면 지급을 넣어 장부를
        맞춰 주세요 — 처음에는 과거 매입이 전부 「안 준 돈」으로 보이는 게 정상입니다. 아래 「출금에서 지급 잡기」로 이미 준 출금을 이어 주면 장부가 진실이 됩니다 (7월 이전 지급은 도입 전이라 이을 매입이 없습니다).
      </p>
      <PayablesUi
        data={data}
        links={links.rows}
        supplierNames={links.supplierNames}
        cashSummary={{ ym: cash.ym, n: cash.open.n, sum: cash.open.sum }}
      />
    </FinShell>
  );
}
