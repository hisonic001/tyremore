import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { taxReconV2 } from "@/lib/tax-recon";
import { TaxRecon } from "./tax-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 세금계산서 대조 (ERP 2단계, 2026-08-24) — 사장님 전용
 *
 *   홈택스에서 올린 매입·매출 세금계산서를 앱의 매입·판매 기록과 잇는다.
 *   자동확정은 「상대 확실 + 금액 정확 + 후보 유일」일 때만 — 나머지는 사람이 확정.
 */
export default async function FinanceTaxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const data = await taxReconV2();

  // 최근 확정 — 잘못 이었으면 여기서 되돌린다
  const recent = await db.execute<{
    id: number; direction: string; d: string; name: string; total: number; refs: number; reason: string | null;
  }>(sql`
    SELECT t.id, t.direction, to_char(t.write_date, 'YYYY-MM-DD') d, t.counterparty_name name, t.total,
           t.recon_reason reason,
           (SELECT count(*)::int FROM recon_match m
             WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id) refs
    FROM tax_invoice t
    WHERE t.is_active AND t.recon_status = '확정'
    ORDER BY t.id DESC LIMIT 30
  `);

  // 정리(무시)된 것 — 잘못 정리했으면 되살린다 (실사용 기간만; 과거분 676건은 제외)
  const cleared = await db.execute<{
    id: number; direction: string; d: string; name: string; total: number; reason: string | null;
  }>(sql`
    SELECT id, direction, to_char(write_date, 'YYYY-MM-DD') d, counterparty_name name, total,
           recon_reason reason
    FROM tax_invoice
    WHERE is_active AND recon_status = '무시' AND write_date >= '2026-08-01'
    ORDER BY id DESC LIMIT 30
  `);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">세금계산서 대조</h1>
        <Link href="/finance" className="text-sm text-slate-600 underline underline-offset-4">
          ← 돈 관리로
        </Link>
      </header>
      <p className="text-sm text-slate-500">
        상대별로 묶어 보여줍니다 — 유형(경비·정산사·거래처)을 한 번 정하면 그 상대는 계속 자동으로
        처리됩니다. 매출 계산서는 판매 기록뿐 아니라 <strong>통장 입금과 직접</strong> 이을 수 있습니다. 대형 거래처 계산서는 보통 월말에 일괄 발행됩니다 — 매입 기록이 먼저 있어도 정상입니다.
      </p>
      <TaxRecon
        data={data}
        recent={recent.map((r) => ({
          id: Number(r.id),
          direction: r.direction,
          d: r.d,
          name: r.name,
          total: Number(r.total),
          refs: Number(r.refs),
          reason: r.reason,
        }))}
        cleared={cleared.map((r) => ({
          id: Number(r.id),
          direction: r.direction,
          d: r.d,
          name: r.name,
          total: Number(r.total),
          reason: r.reason,
        }))}
      />
    </main>
  );
}
