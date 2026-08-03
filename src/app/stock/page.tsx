import Link from "next/link";
import { stockLots } from "@/lib/stock";
import { Stocktake } from "./stocktake";

export const dynamic = "force-dynamic";

/**
 * 창고 실사 화면 (사장님 요청 2026-08-03)
 *
 *   "한눈에 현 재고들을 전부 파악하고 싶은데" → "창고 실사용 화면으로 간편하게. 타이어만."
 *
 * 설계 (docs/10)
 *   · 장갑 낀 손 → 누르는 곳을 크게
 *   · 창고를 도는 순서대로 — **인치별**로 갈라 놓는다
 *   · 세는 것이 목적이다. 「맞음」 한 번이면 끝나야 한다
 *   · 틀렸을 때만 숫자를 고친다. 고친 내역은 이력에 남는다
 */
export default async function StockListPage() {
  const lots = await stockLots();

  const total = lots.reduce((s, l) => s + l.qty, 0);
  const models = new Set(lots.map((l) => l.productId)).size;
  const old = lots.filter((l) => l.ageYears !== null && l.ageYears >= 2);
  const oldQty = old.reduce((s, l) => s + l.qty, 0);
  const noDot = lots.filter((l) => !l.dot).reduce((s, l) => s + l.qty, 0);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">재고 실사</h1>
        <Link href="/" className="shrink-0 text-sm text-slate-500 underline underline-offset-4">
          검색으로
        </Link>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="tabular flex items-baseline gap-4">
          <span className="text-3xl font-bold">{total}</span>
          <span className="text-lg text-slate-500">본</span>
          <span className="ml-auto text-sm text-slate-500">
            {models}종 · {lots.length}묶음
          </span>
        </div>
        {/* 세기 전에 먼저 알아야 하는 것만 — 오래된 것과 DOT 없는 것 */}
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {oldQty > 0 && (
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              2년 넘은 것 {oldQty}본
            </span>
          )}
          {noDot > 0 && (
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 font-medium text-amber-800">
              DOT 없음 {noDot}본
            </span>
          )}
          {oldQty === 0 && noDot === 0 && (
            <span className="rounded-lg bg-emerald-50 px-3 py-1.5 font-medium text-emerald-800">
              오래된 재고 없음
            </span>
          )}
        </div>
      </section>

      <Stocktake lots={lots} />

      <p className="mt-6 text-xs text-slate-400">
        「맞음」을 누르면 <strong>확인한 날짜만</strong> 남고 수량은 그대로입니다. 숫자를 고치면 그
        내역이 이력에 남습니다 — 나중에 실물과 어긋났을 때 원인을 되짚기 위해서입니다.
      </p>
    </main>
  );
}
