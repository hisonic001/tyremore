import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { depositReconData } from "@/lib/recon-data";
import { DepositsRecon } from "./deposits-ui";

export const dynamic = "force-dynamic";

const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

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

  const thisYm = kstToday().slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;

  const data = await depositReconData(ym);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">통장 입금 대조</h1>
        <Link href="/finance" className="text-sm text-slate-600 underline underline-offset-4">
          ← 돈 관리로
        </Link>
      </header>

      <nav className="tabular mt-2 flex items-center justify-center gap-4 text-sm">
        <Link href={`/finance/deposits?ym=${ymAdd(ym, -1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
          ◀ {ymAdd(ym, -1)}
        </Link>
        <span className="font-bold">{ym}</span>
        {ym < thisYm ? (
          <Link href={`/finance/deposits?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
            {ymAdd(ym, 1)} ▶
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-slate-300">다음 달</span>
        )}
      </nav>

      <DepositsRecon data={data} ym={ym} />
    </main>
  );
}
