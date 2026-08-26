import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { payLinkData, payablesData } from "@/lib/recon-data";
import { taxCashData } from "@/lib/tax-recon";
import { pickYm } from "@/lib/ym";
import { PayablesUi } from "./payables-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 미지급 장부 (ERP ⑦, 사장님 지시 2026-08-25) — 사장님 전용
 *
 *   거래처별로 「매입은 했는데 아직 안 준 돈」을 본다 — 외상 장부의 거울상.
 *   지급을 넣으면 오래된 매입부터 선입선출로 채워진다.
 */
export default async function FinancePayablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  // 🔴 2025 감사 F18: 이번 달 고정 → 보는 달 (MonthNav) — 2025 달의 출금도 지급 잡기에 나온다
  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const data = await payablesData();
  const links = await payLinkData(ym);
  // ⭐ 재설계(2026-08-25): 계산서 돈 확인의 정본은 /finance/tax 「돈 확인」 뷰 — 여기는 요약만
  const cash = await taxCashData("매입", ym);

  return (
    <FinShell tab="payables" monthNav={{ ym, basePath: "/finance/payables" }}>
      <p className="mt-2 text-sm text-slate-500">
        줄 돈의 정본은 <strong>세금계산서 ↔ 통장 출금</strong>입니다 — 아래 앱 매입 장부는 보조 참고예요.
      </p>
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer underline underline-offset-2">자세히</summary>
        <p className="mt-1">
          계산서가 출금으로 확인되면 그 매입은 준 것입니다. 앱 매입 장부는 앱에서 입고한 인보이스 기준이라 처음엔
          전부 「안 준 돈」으로 보이는 게 정상 — 「출금에서 지급 잡기」로 보는 달의 매입대금 출금을 이어 주면 장부가
          실제와 같아집니다. 잘못 이었으면 아래 「되돌리기」로 언제든 풉니다.
        </p>
      </details>
      <PayablesUi
        data={data}
        links={links.rows}
        linked={links.linked}
        supplierNames={links.supplierNames}
        cashSummary={{ ym: cash.ym, n: cash.open.n, sum: cash.open.sum }}
      />
    </FinShell>
  );
}
