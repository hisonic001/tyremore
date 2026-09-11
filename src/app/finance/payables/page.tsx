import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { payLinkData, payablesData } from "@/lib/recon-data";
import { bankPayerOptions, payablesCardInfo } from "@/lib/payables-view";
import { taxCashData } from "@/lib/tax-recon";
import { pickYm } from "@/lib/ym";
import { W } from "@/lib/fin-words";
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
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  // 🔴 2025 감사 F18: 이번 달 고정 → 보는 달 (MonthNav) — 2025 달의 출금도 지급 잡기에 나온다
  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const data = await payablesData();
  const links = await payLinkData(ym);
  // ⭐ 리모델링(2026-08-31) — 거래처마다 세 장부(준 돈·계산서·자동 대사·선급금)를 한 장으로
  const cards = await payablesCardInfo(ym, data.suppliers.map((s) => s.supplier));
  const payerOptions = await bankPayerOptions(ym);
  // ⭐ 재설계(2026-08-25): 계산서 대사의 정본은 /finance/tax 「계산서 대사」 뷰 — 여기는 요약만
  const cash = await taxCashData("매입", ym);
  // 🔴 2단계(2026-09-12): links.skipped·links.linked(되돌리기 표 2개)는 「최근 한 일」로 옮겨 안 넘긴다

  return (
    <FinShell tab="payables" monthNav={{ ym, basePath: "/finance/payables" }}>
      <p className="mt-2 text-sm text-slate-500">
        {W.payable}의 정본은 <strong>세금계산서 ↔ 통장 출금</strong>입니다 — 아래 앱 매입 장부는 보조 참고예요.
      </p>
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer underline underline-offset-2">자세히</summary>
        <p className="mt-1">
          계산서가 출금으로 확인되면 그 매입은 준 것입니다. 앱 매입 장부는 앱에서 입고한 인보이스 기준이라 처음엔
          전부 「안 준 돈」으로 보이는 게 정상 — 「출금에서 {W.reconPay}」로 보는 달의 매입대금 출금을 {W.recon}해 주면 장부가
          실제와 같아집니다. 잘못 {W.recon}했으면 「{W.activity}」에서 언제든 되돌립니다.
        </p>
      </details>
      <PayablesUi
        data={data}
        cards={cards}
        payerOptions={payerOptions}
        links={links.rows}
        supplierNames={links.supplierNames}
        cashSummary={{ ym: cash.ym, n: cash.open.n, sum: cash.open.sum }}
      />
    </FinShell>
  );
}
