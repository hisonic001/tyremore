import Link from "@/lib/link";
import { SaleForm } from "./client";

export const dynamic = "force-dynamic";

/**
 * 판매 등록 — 종이 「차량 점검 및 주문 보고서」의 작업 내역·견적 칸을 대신한다.
 * 저장하면 재고가 빠지고 MARS 입력 대기열에 올라간다.
 */
export default function SalePage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <div className="flex gap-3">
          <Link href="/sales" className="text-sm font-medium text-slate-600 underline underline-offset-4">
            정비 내역
          </Link>
          <Link href="/mars" className="text-sm font-medium text-indigo-700 underline underline-offset-4">
            MARS 대기열 →
          </Link>
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-bold">판매 등록</h1>
      <p className="mt-1 text-sm text-slate-500">
        저장하면 재고가 빠지고 MARS 입력 대기열에 올라갑니다.
      </p>
      <SaleForm />
    </main>
  );
}
