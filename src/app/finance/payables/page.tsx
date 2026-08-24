import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { payLinkData, payablesData } from "@/lib/recon-data";
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

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">미지급 장부</h1>
        <Link href="/finance" className="text-sm text-slate-600 underline underline-offset-4">
          ← 돈 관리로
        </Link>
      </header>
      <p className="text-sm text-slate-500">
        매입 인보이스 금액에서 지급한 만큼을 뺀 잔액입니다. 이미 다 준 매입이면 지급을 넣어 장부를
        맞춰 주세요 — 처음에는 과거 매입이 전부 「안 준 돈」으로 보이는 게 정상입니다. 아래 「출금에서 지급 잡기」로 이미 준 출금을 이어 주면 장부가 진실이 됩니다 (7월 이전 지급은 도입 전이라 이을 매입이 없습니다).
      </p>
      <PayablesUi data={data} links={links.rows} />
    </main>
  );
}
