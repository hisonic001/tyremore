import Link from "next/link";
import { saleHistory } from "@/lib/sale-history";
import { SaleCard } from "./client";
import { PeriodFilter } from "./filter";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * 정비 내역 (사장님 요청 2026-08-04)
 *
 *   "날짜마다 어떤 정비내역이 있는지 확인 가능해야함."
 *
 * MARS 대기열이 「앞으로 칠 것」이라면 여기는 **지나간 것 전부**다.
 * 날짜별로 묶고, 고객·차량 카드에서 「정비 이력」으로 바로 들어온다.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    range?: string;
    from?: string;
    to?: string;
    customer?: string;
    vehicle?: string;
    canceled?: string;
  }>;
}) {
  const sp = await searchParams;
  const customerId = sp.customer ? Number(sp.customer) : undefined;
  const vehicleId = sp.vehicle ? Number(sp.vehicle) : undefined;
  const includeCanceled = sp.canceled === "1";
  const scoped = Number.isFinite(customerId) || Number.isFinite(vehicleId);

  /**
   * ⭐ 기간 필터 — 기본은 **오늘** (사장님 요청 2026-08-05).
   *    과거 이력 3,100건이 들어와 「전체」 기본은 무겁고 오늘 일이 묻힌다.
   *    단, 고객·차량 이력으로 들어왔을 때는 전체가 기본 — 카드에서 온 사람은
   *    「이 차의 과거」를 보러 온 것이니까.
   */
  const today = new Date().toLocaleDateString("sv-SE");
  const thisMonth = today.slice(0, 7);
  const explicit = sp.range ?? (sp.month ? "month" : sp.from || sp.to ? "range" : null);
  const active = explicit ?? (scoped ? "all" : "today");

  const h = await saleHistory({
    month: active === "month" ? sp.month : active === "thisMonth" ? thisMonth : undefined,
    from: active === "today" ? today : active === "range" ? sp.from : undefined,
    to: active === "today" ? today : active === "range" ? sp.to : undefined,
    customerId: Number.isFinite(customerId) ? customerId : undefined,
    vehicleId: Number.isFinite(vehicleId) ? vehicleId : undefined,
    includeCanceled,
  });

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      month: sp.month,
      range: sp.range,
      from: sp.from,
      to: sp.to,
      customer: sp.customer,
      vehicle: sp.vehicle,
      canceled: sp.canceled,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <Link href="/sale" className="text-sm font-medium text-emerald-700 underline underline-offset-4">
          판매 등록 →
        </Link>
      </div>

      <h1 className="mt-3 text-2xl font-bold">정비 내역</h1>
      {h.filterLabel ? (
        <p className="mt-1 text-sm text-slate-600">
          <strong>{h.filterLabel}</strong> 의 정비 이력입니다.{" "}
          <Link href="/sales" className="text-slate-500 underline underline-offset-4">
            전체 보기
          </Link>
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">날짜별로 무엇을 정비했는지. 여기서 고치고 취소합니다.</p>
      )}

      {/* ⭐ 기간 필터 — 오늘·이번 달·전체·월·기간 (사장님 요청 2026-08-05) */}
      <PeriodFilter
        months={h.months}
        active={active}
        month={sp.month ?? null}
        from={sp.from ?? null}
        to={sp.to ?? null}
        keep={{ customer: sp.customer, vehicle: sp.vehicle, canceled: sp.canceled }}
      />

      <p className="tabular mt-3 text-sm text-slate-600">
        {active === "today" && `오늘(${today}) · `}
        {active === "thisMonth" && `${thisMonth} · `}
        {h.saleCount}건 · {won(h.totalAmount)}원
      </p>

      {h.days.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          정비 내역이 없습니다
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {h.days.map((d) => (
            <section key={d.date}>
              <div className="flex items-baseline justify-between px-1">
                <h2 className="tabular font-semibold">{d.date}</h2>
                <span className="tabular text-sm text-slate-500">
                  {d.qty > 0 && `타이어 ${d.qty}본 · `}
                  {won(d.amount)}원
                </span>
              </div>
              <ul className="mt-1.5 space-y-2">
                {d.sales.map((s) => (
                  <SaleCard key={s.quoteId} sale={s} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <Link
          href={`/sales${qs({ canceled: includeCanceled ? undefined : "1" })}`}
          className="text-xs text-slate-400 underline underline-offset-4"
        >
          {includeCanceled ? "취소된 것 감추기" : "취소된 것도 보기"}
        </Link>
      </div>
    </main>
  );
}
