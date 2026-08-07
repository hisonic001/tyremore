import Link from "@/lib/link";
import { listSuppliers } from "@/lib/supplier";
import { SupplierManager } from "./client";

export const dynamic = "force-dynamic";

/**
 * 거래처 관리 (사장님 요청 2026-08-03)
 *   "설정에 거래처 추가 수정 삭제가 가능한 기능도 추가해줘"
 */
export default async function SuppliersPage() {
  const rows = await listSuppliers();
  const active = rows.filter((r) => r.isActive).length;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">거래처</h1>
      <p className="mt-1 text-sm text-slate-500">
        매입 입고에서 고르는 목록입니다. {active}곳 사용 중
        {rows.length > active && ` · ${rows.length - active}곳 숨김`}
      </p>

      <SupplierManager rows={rows} />

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        이름을 고치면 <strong>지난 매입 내역의 거래처 이름도 같이 바뀝니다</strong> — 내역이 옛 이름에
        남아 갈라지지 않게 하기 위해서입니다. 매입 내역이 있는 거래처는 지울 수 없고 숨기기만 됩니다.
      </p>
    </main>
  );
}
