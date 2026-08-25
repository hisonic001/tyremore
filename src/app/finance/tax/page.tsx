import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import Link from "@/lib/link";
import { FinShell } from "@/components/fin/shell";
import { pickYm } from "@/lib/ym";
import { taxCashData, taxReconV2 } from "@/lib/tax-recon";
import { TaxRecon } from "./tax-ui";
import { MoneyView, type RecentBankRow } from "./money-view";

export const dynamic = "force-dynamic";

/**
 * ⭐ 세금계산서 (재설계 2026-08-25, 사장님 요구: "실제로 출금·입금 됐는지 검토 가능")
 *
 *   기본 뷰 = 「돈 확인」 — 매입=출금·매출=입금이 실제로 오갔는지 (bank_ok 기준 진행률).
 *   두 번째 뷰 = 「계산서 정리」 — 상대 유형·앱 기록 잇기·과거분 (기존 화면).
 */
export default async function FinanceTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const sp = await searchParams;
  const view = sp.view === "sort" ? "sort" : "money";
  const segCls = (on: boolean) =>
    `flex-1 rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
      on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
    }`;
  const segNav = (
    <nav className="mt-2 flex gap-1 rounded-xl bg-slate-100 p-1">
      <Link href="/finance/tax?view=money" className={segCls(view === "money")}>
        돈 확인
      </Link>
      <Link href="/finance/tax?view=sort" className={segCls(view === "sort")}>
        계산서 정리
      </Link>
    </nav>
  );

  if (view === "money") {
    const direction = sp.direction === "매출" ? ("매출" as const) : ("매입" as const);
    const ym = pickYm(sp.ym);
    const data = await taxCashData(direction, ym);
    // 최근 통장 연결 — 잘못 이었으면 통장 연결만 되돌린다
    const recent = await db.execute<{ id: number; d: string; direction: string; name: string; total: number }>(sql`
      SELECT id, to_char(write_date, 'MM-DD') d, direction, counterparty_name name, total
      FROM tax_invoice
      WHERE is_active AND recon_reason IN ('출금연결', '입금연결')
      ORDER BY id DESC LIMIT 20
    `);
    const recentBank: RecentBankRow[] = recent.map((r) => ({
      id: Number(r.id),
      d: r.d,
      direction: r.direction,
      name: r.name,
      total: Number(r.total),
    }));
    return (
      <FinShell tab="tax" monthNav={{ ym, basePath: "/finance/tax", keep: { view: "money", direction } }}>
        {segNav}
        <p className="mt-2 text-sm text-slate-500">
          계산서마다 <strong>실제 돈이 오갔는지</strong>를 통장과 맞춰 봅니다 — 매입은 출금, 매출은
          입금. 앱 기록 잇기·상대 유형은 「계산서 정리」에서.
        </p>
        <MoneyView data={data} recentBank={recentBank} />
      </FinShell>
    );
  }

  // ── 계산서 정리 뷰 (기존 화면) ──
  const data = await taxReconV2();
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
    <FinShell tab="tax">
      {segNav}
      <p className="mt-2 text-sm text-slate-500">
        계산서의 <strong>신원</strong>을 정리합니다 — 상대 유형(경비·정산사·거래처)·앱 기록 잇기·
        과거분. 대형 거래처 계산서는 보통 월말 일괄 발행이라 매입 기록이 먼저 있어도 정상입니다.
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
    </FinShell>
  );
}
