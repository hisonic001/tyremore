import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { TableWrap, Money } from "@/components/fin/table";
import { partyListData } from "@/lib/party-ledger";

export const dynamic = "force-dynamic";

/**
 * ⭐ 거래처 목록 (ERP 구조화 배치3, 2026-08-25) — 사장님 전용
 *   거래처별 미지급·외상 잔액 한 표 + 이름을 누르면 원장으로.
 */
export default async function FinancePartyListPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const list = await partyListData();
  const sorted = [...list].sort(
    (a, b) => b.payableRemain + b.receivableRemain - (a.payableRemain + a.receivableRemain) || a.name.localeCompare(b.name, "ko"),
  );

  return (
    <FinShell tab="party">
      <p className="mt-2 text-sm text-slate-500">
        거래처 이름을 누르면 <strong>원장</strong>(계산서·입출금·매입·판매·지급·수금을 시간순 한
        표)이 열립니다. 거래처 등록·수정은{" "}
        <Link href="/settings/suppliers" className="underline">설정 › 거래처</Link>에서.
      </p>
      <TableWrap isEmpty={sorted.length === 0} empty="거래처가 없습니다" minWidth={480}>
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-1.5 text-left">거래처</th>
            <th className="text-right">줄 돈 (미지급)</th>
            <th className="text-right">받을 돈 (외상)</th>
            <th className="text-right"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name} className="border-t border-slate-100">
              <td className="py-1.5">
                <Link
                  href={`/finance/party/${encodeURIComponent(`S:${r.name}`)}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {r.name}
                </Link>
              </td>
              <td className="text-right">
                {r.payableRemain > 0 ? <span className="text-red-600"><Money n={r.payableRemain} /></span> : <span className="text-slate-300">—</span>}
              </td>
              <td className="text-right">
                {r.receivableRemain > 0 ? <span className="text-emerald-700"><Money n={r.receivableRemain} /></span> : <span className="text-slate-300">—</span>}
              </td>
              <td className="text-right text-xs text-slate-400">
                <Link href={`/finance/party/${encodeURIComponent(`S:${r.name}`)}`} className="underline">
                  원장 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </FinShell>
  );
}
