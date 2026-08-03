import Link from "next/link";
import { pendingInvoices } from "@/lib/invoice";
import { InvoiceUpload, PendingList } from "./client";
import { ManualPurchase } from "./manual";

export const dynamic = "force-dynamic";

/**
 * 매입 입고 (2026-08-01)
 *   ① 인보이스를 올려 「입고 예정」으로 등록
 *   ② 실물이 도착하면 확정 → 재고가 된다
 */
export default async function ReceivingPage() {
  const invoices = await pendingInvoices();
  const totalPending = invoices.reduce((s, i) => s + i.remain, 0);

  /**
   * 진행 중인 직접 매입 장부 (아직 입고 안 한 것).
   * 여럿이면 **가장 최근 것**을 연다 — 장부 번호에 날짜와 순번이 들어 있다.
   */
  const openManual =
    invoices
      .filter((i) => i.invoiceNo.startsWith("직접-"))
      .sort((a, b) => b.invoiceNo.localeCompare(a.invoiceNo))[0] ?? null;

  /** 위 스캔 화면에 이미 떠 있는 장부는 아래 목록에서 뺀다 (같은 것이 두 번 나오지 않게) */
  const listed = invoices.filter((i) => i.invoiceId !== openManual?.invoiceId);

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

      {/* ⭐ 인보이스가 없는 사매입 — 바코드 또는 품목 검색으로 목록을 만들어 간다 */}
      <ManualPurchase open={openManual} />

      <section className="mt-8">
        <h2 className="font-semibold">
          입고 예정
          {totalPending > 0 && (
            <span className="tabular ml-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-bold text-amber-900">
              {totalPending}본
            </span>
          )}
        </h2>
        {listed.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            기다리는 물건이 없습니다
          </p>
        ) : (
          <PendingList invoices={listed} />
        )}
      </section>
    </main>
  );
}
