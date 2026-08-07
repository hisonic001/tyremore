import Link from "@/lib/link";
import { isOwner } from "@/lib/auth";
import { purchaseHistory } from "@/lib/purchase-history";
import { HistoryList } from "./client";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString();

/** '2026-08' → '2026년 8월' */
function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  return `${y}년 ${Number(mm)}월`;
}

/**
 * 매입 내역 (사장님 요청 2026-08-03)
 *   "매입내역을 날짜별로 쭉 확인해볼수 있는 기능도 어딘가 넣어줬으면 좋겠는데"
 *
 * 「입고 예정」은 아직 안 온 물건만 보여준다. 여기는 **지나간 것까지 전부**다.
 * ⚠️ 금액은 사장님 화면에만 나온다 (D-05 5번). 서버에서 아예 빼고 내려보낸다.
 */
export default async function PurchaseHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; supplier?: string }>;
}) {
  const sp = await searchParams;
  // 매입가 노출 여부는 **여기서** 정한다 (D-05 5번)
  const h = await purchaseHistory(await isOwner(), sp.month, sp.supplier);

  const qs = (next: { month?: string | null; supplier?: string | null }) => {
    const p = new URLSearchParams();
    const month = next.month === undefined ? sp.month : next.month;
    const supplier = next.supplier === undefined ? sp.supplier : next.supplier;
    if (month) p.set("month", month);
    if (supplier) p.set("supplier", supplier);
    const s = p.toString();
    return s ? `/receiving/history?${s}` : "/receiving/history";
  };

  const CHIP = "rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap";
  const ON = "bg-slate-900 text-white";
  const OFF = "border border-slate-300 bg-white text-slate-600";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/receiving" className="text-sm text-slate-500 underline underline-offset-4">
        ← 매입 입고로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">매입 내역</h1>

      {/* 기간 고르기 — 달 단위. 가로로 넘긴다 */}
      <div className="-mx-4 mt-3 overflow-x-auto px-4">
        <div className="flex gap-2">
          <Link href={qs({ month: null })} className={`${CHIP} ${!sp.month ? ON : OFF}`}>
            전체
          </Link>
          {h.months.map((m) => (
            <Link key={m} href={qs({ month: m })} className={`${CHIP} ${sp.month === m ? ON : OFF}`}>
              {monthLabel(m)}
            </Link>
          ))}
        </div>
      </div>

      {/* 거래처로 좁혔을 때만 보여준다 — 평소엔 화면을 차지하지 않게 */}
      {sp.supplier && (
        <div className="mt-2">
          <Link
            href={qs({ supplier: null })}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            {sp.supplier} <span className="text-slate-300">✕</span>
          </Link>
        </div>
      )}

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="tabular flex items-baseline gap-3">
          <span className="text-3xl font-bold">{h.totalQty}</span>
          <span className="text-lg text-slate-500">본</span>
          {h.totalAmount !== null && (
            <span className="ml-auto text-right">
              <span className="text-xl font-bold">{won(h.totalAmount)}</span>
              <span className="ml-1 text-sm text-slate-500">원</span>
              <span className="block text-xs text-slate-400">공급가액 · VAT 별도</span>
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {sp.month ? monthLabel(sp.month) : "전체 기간"} · 매입 {h.invoiceCount}건
          {!h.canSeeMoney && " · 금액은 사장님 계정에서만 보입니다"}
        </p>

        {/* 거래처별 — 눌러서 좁힌다 */}
        {h.bySupplier.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {h.bySupplier.map((s) => (
              <li key={s.supplier}>
                <Link
                  href={qs({ supplier: sp.supplier === s.supplier ? null : s.supplier })}
                  className="flex items-baseline justify-between gap-3 py-2 active:bg-slate-50"
                >
                  <span className="truncate font-medium">{s.supplier}</span>
                  <span className="tabular shrink-0 text-sm text-slate-500">
                    {s.qty}본
                    {s.amount !== null && ` · ${won(s.amount)}원`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {h.days.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          이 기간에 매입한 것이 없습니다
        </p>
      ) : (
        <HistoryList days={h.days} />
      )}
    </main>
  );
}
