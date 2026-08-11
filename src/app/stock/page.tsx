import Link from "@/lib/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listPartStock } from "@/lib/part-stock";
import { StockExcel } from "./excel-ui";
import { PartStockList } from "./parts";

export const dynamic = "force-dynamic";

/**
 * 재고 — 엑셀로 내려받고, 고쳐서 다시 올린다 (사장님 지시 2026-08-03)
 *
 *   "재고 기능을 전반적으로 수정해야할것 같아. 재고를 엑셀로 다운로드 & 업로드 하는 기능으로 수정."
 *
 * 화면에서 한 줄씩 누르던 방식(실사·± 버튼)은 걷어냈다. 창고에서 세는 것보다
 * 익숙한 엑셀에서 한꺼번에 고치는 편이 빠르다는 판단이다.
 *
 * ⚠️ 매입 입고(/receiving)는 그대로 둔다 — 그건 「산 물건이 들어왔다」는 별개의 흐름이고,
 *    거기서 들어온 재고도 여기 엑셀에 그대로 나온다.
 */
export default async function StockPage() {
  const [s] = await db.execute<{ qty: number; lots: number; models: number; old: number; nodot: number }>(sql`
    SELECT COALESCE(SUM(s.qty),0)::int qty,
           count(DISTINCT (p.id::text || '|' || COALESCE(s.dot,'')))::int lots,
           count(DISTINCT p.id)::int models,
           COALESCE(SUM(s.qty) FILTER (
             WHERE s.dot ~ '^[0-9]{4}$'
               AND (2000 + substr(s.dot,3,2)::int) <= date_part('year', now())::int - 2
           ),0)::int old,
           COALESCE(SUM(s.qty) FILTER (WHERE s.dot IS NULL),0)::int nodot
    FROM stock_item s JOIN product p ON p.id = s.product_id
    WHERE s.status='재고' AND s.qty > 0 AND p.item_type='tire'
  `);

  // ⭐ 부품 재고 (사장님 선택 2026-08-11) — 타이어와 달리 종류별 수량으로 관리
  const parts = await listPartStock();

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">재고</h1>
        <Link href="/" className="shrink-0 text-sm text-slate-500 underline underline-offset-4">
          검색으로
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="tabular flex items-baseline gap-3">
          <span className="text-3xl font-bold">{s?.qty ?? 0}</span>
          <span className="text-lg text-slate-500">본</span>
          <span className="ml-auto text-sm text-slate-500">
            {s?.models ?? 0}종 · {s?.lots ?? 0}줄
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {Number(s?.old ?? 0) > 0 && (
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              2년 넘은 것 {s.old}본
            </span>
          )}
          {Number(s?.nodot ?? 0) > 0 && (
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              DOT 없음 {s.nodot}본
            </span>
          )}
        </div>
      </section>

      <PartStockList parts={parts} />

      <StockExcel />

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        판매 등록하면 재고가 자동으로 빠지고, 매입 입고하면 자동으로 늘어납니다. 엑셀은{" "}
        <strong>실물과 어긋난 것을 한꺼번에 맞출 때</strong> 쓰세요. 모든 변경은 이력에 남습니다.
      </p>
    </main>
  );
}
