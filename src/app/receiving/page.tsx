import Link from "next/link";
import { pendingInvoices } from "@/lib/invoice";
import { InvoiceUpload, PendingList } from "./client";

export const dynamic = "force-dynamic";

/**
 * 매입 입고 (2026-08-01)
 *   ① 인보이스를 올려 「입고 예정」으로 등록
 *   ② 실물이 도착하면 확정 → 재고가 된다
 */
export default async function ReceivingPage() {
  const invoices = await pendingInvoices();
  const totalPending = invoices.reduce((s, i) => s + i.remain, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">매입 입고</h1>
      <p className="mt-1 text-sm text-slate-500">
        인보이스를 올려 두면 물건이 도착했을 때 확정만 하면 됩니다.
      </p>

      <InvoiceUpload />

      <section className="mt-8">
        <h2 className="font-semibold">
          입고 예정
          {totalPending > 0 && (
            <span className="tabular ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold text-amber-900">
              {totalPending}본
            </span>
          )}
        </h2>
        {invoices.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            기다리는 물건이 없습니다
          </p>
        ) : (
          <PendingList invoices={invoices} />
        )}
      </section>
    </main>
  );
}
