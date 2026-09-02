import Link from "@/lib/link";
import { listSuppliers, supplierExtras } from "@/lib/supplier";
import { isOwner } from "@/lib/auth";
import { bankPayerOptions } from "@/lib/payables-view";
import { kstToday } from "@/lib/ym";
import { SupplierManager } from "./client";

export const dynamic = "force-dynamic";

/**
 * 거래처 관리 (사장님 요청 2026-08-03) → ⭐ 「거래처 한 장」 (2026-09-02)
 *   "거래처 고치기 클릭시 각 거래처별로 연결된 계좌명들, 차량들이 수정가능 …
 *    돈관리 부분 연동 … 거래처 정보가 더 자세히"
 *
 * 돈·별명·차량·규칙은 사장님 전용 — 직원 화면은 기본 정보만.
 */
export default async function SuppliersPage() {
  const rows = await listSuppliers();
  const active = rows.filter((r) => r.isActive).length;
  const owner = await isOwner();
  // 연동 묶음(돈·별명·차고·사업자번호 제안·규칙) — 함수 안에서 한 번 더 owner 를 확인한다
  const extras = owner ? await supplierExtras() : null;
  // 별명 추가 후보 — 이번 달 통장 출금 적요 (payables 와 같은 공급원)
  const payerOptions = owner ? await bankPayerOptions(kstToday().slice(0, 7)).catch(() => []) : [];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-xl font-bold">거래처</h1>
      <p className="mt-1 text-sm text-slate-500">
        매입 입고에서 고르는 목록입니다. {active}곳 사용 중
        {rows.length > active && ` · ${rows.length - active}곳 숨김`}
      </p>

      <SupplierManager rows={rows} extras={extras} owner={owner} payerOptions={payerOptions} />

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        이름을 고치면 <strong>지난 매입 내역의 거래처 이름도 같이 바뀝니다</strong> — 내역이 옛 이름에
        남아 갈라지지 않게 하기 위해서입니다. 매입 내역이 있는 거래처는 지울 수 없고 숨기기만 됩니다.
        사업자번호를 채우면 세금계산서 자동확정과 거래처 원장이 정확해집니다.
      </p>
    </main>
  );
}
