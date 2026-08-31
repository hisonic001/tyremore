import Link from "@/lib/link";
import { isOwner } from "@/lib/auth";
import { SaleForm } from "./client";

export const dynamic = "force-dynamic";

/**
 * 판매 등록 — 종이 「차량 점검 및 주문 보고서」의 작업 내역·견적 칸을 대신한다.
 * 저장하면 재고가 빠지고 MARS 입력 대기열에 올라간다.
 */
export default async function SalePage() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6 lg:max-w-6xl">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <Link href="/sales" className="text-sm font-medium text-slate-600 underline underline-offset-4">
          정비 내역 →
        </Link>
      </div>
      <h1 className="mt-3 text-xl font-bold">판매 등록</h1>
      <p className="mt-1 text-sm text-slate-500">
        저장하면 재고가 빠지고 정비 내역에 남습니다. MARS 는 정비 내역에서 골라 올립니다.
      </p>
      <SaleForm owner={await isOwner()} />
    </main>
  );
}
