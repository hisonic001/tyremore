import Link from "@/lib/link";
import { isOwner } from "@/lib/auth";
import { NO_BRAND, purchaseHistory } from "@/lib/purchase-history";
import { PeriodFilter } from "@/components/ui/period-filter";
import { ChipLink } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { HistoryList } from "./client";
import { SupplierSearch } from "./supplier-search";

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
 * ⭐ 2026-08-29 (사장님 요청) — "내역이 너무 많아서 세로로 길어지니 **일단 오늘 입고한
 *    내역만** 보여주고, 정비내역에서처럼 **날짜 필터링**이 필요함. **브랜드별**로도
 *    확인할수도 있고 **거래처별**로도 확인이 가능했으면 좋겠음."
 *
 *   · 기본이 「전체 기간」이라 처음 열면 20일치 65장부가 통째로 나왔다 → **기본을 오늘로**
 *   · 기간 어휘·동작은 정비 내역과 **한 벌**을 쓴다 (components/ui/period-filter)
 *   · 브랜드는 칩, 거래처는 검색창 (사장님 결정)
 *
 * 「입고 예정」은 아직 안 온 물건만 보여준다. 여기는 **지나간 것까지 전부**다.
 * ⚠️ 금액은 사장님 화면에만 나온다 (D-05 5번). 서버에서 아예 빼고 내려보낸다.
 */
export default async function PurchaseHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    month?: string;
    from?: string;
    to?: string;
    supplier?: string;
    brand?: string;
  }>;
}) {
  const sp = await searchParams;

  /**
   * 🔴 기간 해석은 `/sales` 와 **글자 그대로 같은 규칙**이다 (sales/page.tsx:61-67).
   *    두 화면에서 「오늘」의 뜻이 갈리면 사장님이 두 화면을 못 견준다.
   */
  const kst = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const today = kst(new Date());
  const yesterday = kst(new Date(Date.now() - 86400_000));
  const thisMonth = today.slice(0, 7);
  const explicit = sp.range ?? (sp.month ? "month" : sp.from || sp.to ? "range" : null);
  // ⭐ 기본은 **오늘** (전에는 전체 기간이었다)
  const active = explicit ?? "today";

  // 매입가 노출 여부는 **여기서** 정한다 (D-05 5번)
  const h = await purchaseHistory(await isOwner(), {
    month: active === "month" ? sp.month : active === "thisMonth" ? thisMonth : undefined,
    from: active === "today" ? today : active === "yesterday" ? yesterday : active === "range" ? sp.from : undefined,
    to: active === "today" ? today : active === "yesterday" ? yesterday : active === "range" ? sp.to : undefined,
    supplier: sp.supplier,
    brand: sp.brand,
  });

  /** 지금 쿼리를 지키면서 한 축만 바꾼다 */
  const keep = {
    range: sp.range,
    month: sp.month,
    from: sp.from,
    to: sp.to,
    supplier: sp.supplier,
    brand: sp.brand,
  };
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/receiving/history?${s}` : "/receiving/history";
  };

  const periodLabel =
    active === "today"
      ? `오늘 (${today})`
      : active === "yesterday"
        ? `어제 (${yesterday})`
        : active === "thisMonth"
          ? monthLabel(thisMonth)
          : active === "month" && sp.month
            ? monthLabel(sp.month)
            : active === "range"
              ? `${sp.from ?? "처음"} ~ ${sp.to ?? "지금"}`
              : "전체 기간";
  const brandOn = h.byBrand.find((b) => b.key === sp.brand) ?? null;
  const hidden = h.totalInvoiceCount - h.invoiceCount;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5 pb-24">
      <Link href="/receiving" className="text-sm text-slate-500 underline underline-offset-4">
        ← 매입 입고로
      </Link>
      <h1 className="mt-3 text-xl font-bold">매입 내역</h1>

      {/* ① 기간 — 정비 내역과 같은 부품·같은 어휘 */}
      <PeriodFilter
        basePath="/receiving/history"
        months={h.months}
        active={active}
        month={sp.month ?? null}
        from={sp.from ?? null}
        to={sp.to ?? null}
        keep={keep}
      />

      {/* ② 브랜드 — 그 기간에 실제로 매입한 것만 (18개를 다 깔면 그게 또 길다) */}
      {h.byBrand.length > 0 && (
        <div className="-mx-4 mt-2 overflow-x-auto px-4">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-slate-400">브랜드</span>
            <ChipLink href={qs({ brand: undefined })} active={!sp.brand}>
              전체
            </ChipLink>
            {h.byBrand.map((b) => (
              <ChipLink key={b.key} href={qs({ brand: sp.brand === b.key ? undefined : b.key })} active={sp.brand === b.key}>
                <span className="whitespace-nowrap">
                  {b.key === NO_BRAND ? "브랜드 없음" : b.label}
                  <span className={`tabular ml-1.5 text-xs ${sp.brand === b.key ? "text-slate-300" : "text-slate-400"}`}>
                    {b.qty}
                    {b.unit}
                  </span>
                </span>
              </ChipLink>
            ))}
          </div>
        </div>
      )}

      {/* ③ 거래처 — 검색창 (사장님 결정 2026-08-29) */}
      <SupplierSearch
        value={sp.supplier ?? null}
        options={h.bySupplier.map((s) => ({ key: s.key, label: s.label, qty: s.qty, unit: s.unit }))}
        keep={keep}
      />

      {/* ④ 요약 */}
      <section className="mt-3 rounded-card border border-slate-200 bg-white p-4">
        <div className="tabular flex items-baseline gap-3">
          <span className="text-3xl font-bold">{h.totalQty}</span>
          <span className="text-lg text-slate-500">{h.totalUnit}</span>
          {h.totalAmount !== null && (
            <span className="ml-auto text-right">
              <span className="text-xl font-bold">{won(h.totalAmount)}</span>
              <span className="ml-1 text-sm text-slate-500">원</span>
              <span className="block text-xs text-slate-400">공급가액 · VAT 별도</span>
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {periodLabel} · 매입 {h.invoiceCount}건
          {hidden > 0 && <span className="text-amber-700"> (많아서 {hidden}건은 안 보임 — 기간을 좁혀 주세요)</span>}
          {!h.canSeeMoney && " · 금액은 사장님 계정에서만 보입니다"}
        </p>
        {/* 🔴 브랜드로 좁히면 합계가 인보이스 원문과 달라진다 — 왜 다른지 말해 준다 */}
        {brandOn && (
          <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            <strong>{brandOn.key === NO_BRAND ? "브랜드가 안 정해진 줄" : brandOn.label}</strong> 만 보고 있습니다 —
            같은 장부의 다른 브랜드 줄은 숨겨져 있고, 위 합계도 이 줄들로만 셌습니다.
          </p>
        )}
      </section>

      {h.days.length === 0 ? (
        <EmptyState
          emoji="📦"
          title={`${periodLabel}에 매입한 것이 없습니다`}
          hint="위에서 「어제」나 「이번 달」을 눌러 보세요."
        />
      ) : (
        <HistoryList days={h.days} owner={h.canSeeMoney} />
      )}
    </main>
  );
}
