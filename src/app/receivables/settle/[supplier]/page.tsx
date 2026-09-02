import Link from "@/lib/link";
import {hasPerm, requireSession } from "@/lib/auth";
import { settlementView } from "@/lib/settlement-data";
import { kstToday } from "@/lib/ym";
import { SettleClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * ⭐ 거래처×달 정산 화면 (사장님 요청 2026-09-01)
 *
 *   ① 내역 확인 → ② 청구서 내려받기 → ③ 회신 반영(붙여넣기·엑셀·손) →
 *   ④ 차이 검토 → ⑤ 한꺼번에 적용 → ⑥ 입금 반영. 되돌리기 가능(소프트).
 */
export default async function SettleSupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ supplier: string }>;
  searchParams: Promise<{ ym?: string }>;
}) {
  await requireSession();
  const owner = await hasPerm("finance");
  const supplier = decodeURIComponent((await params).supplier);
  const sp = await searchParams;
  const today = kstToday();
  const prevYm = new Date(Date.parse(`${today.slice(0, 7)}-01`) - 86400000).toISOString().slice(0, 7);
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? "") ? sp.ym! : prevYm;

  if (!owner) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
        <p className="mt-6 rounded-xl bg-slate-100 p-6 text-center text-sm text-slate-600">
          월 정산은 사장님 계정 전용입니다.
        </p>
      </main>
    );
  }

  const view = await settlementView(supplier, ym);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6 lg:max-w-4xl">
      <Link href="/receivables/settle" className="text-sm text-slate-500 underline underline-offset-4">
        ← 정산 관리대장
      </Link>
      <SettleClient view={view} />
    </main>
  );
}
