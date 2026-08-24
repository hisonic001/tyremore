import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { taxReconData } from "@/lib/recon-data";
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

  const data = await taxReconData();

  // 최근 확정 — 잘못 이었으면 여기서 되돌린다
  const recent = await db.execute<{ id: number; direction: string; d: string; name: string; total: number; refs: number }>(sql`
    SELECT t.id, t.direction, to_char(t.write_date, 'YYYY-MM-DD') d, t.counterparty_name name, t.total,
           (SELECT count(*)::int FROM recon_match m
             WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id) refs
    FROM tax_invoice t
    WHERE t.is_active AND t.recon_status = '확정'
    ORDER BY t.id DESC LIMIT 10
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
        홈택스 세금계산서가 앱의 매입·판매 기록과 같은 건인지 잇는 화면입니다. 확실한 것만 자동으로
        잇고, 애매한 것은 사장님이 정하십니다.
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
        }))}
      />
    </main>
  );
}
