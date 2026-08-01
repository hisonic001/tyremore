import Link from "next/link";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * ⭐ 검색창 하나 — D-11 1번
 * 차량번호·전화·이름·규격·바코드를 입력 패턴으로 자동 판별한다.
 * 정비사가 "무엇을 검색할지" 고르는 단계를 없앤다.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const result = q.trim() ? await search(q) : null;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">타이어모어</h1>
        <Link href="/status" className="text-sm text-slate-500 underline underline-offset-4">
          이관 현황
        </Link>
      </header>

      <form action="/" method="get">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          autoComplete="off"
          placeholder="차량번호 · 전화 · 이름 · 규격"
          aria-label="통합 검색"
          className="w-full rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-2xl
                     shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900"
        />
      </form>

      {!result && (
        <div className="mt-8 space-y-2 text-sm text-slate-500">
          <p className="font-medium text-slate-700">이렇게 쳐 보세요 — 무엇을 찾을지 고를 필요가 없습니다</p>
          <ul className="space-y-1">
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">12가3456</code> 차량번호 전체</li>
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">3456</code> 뒷 4자리만 — 고객은 이렇게 말합니다</li>
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">010…</code> 전화번호</li>
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">225/45R17</code> 또는 <code className="rounded bg-slate-200 px-1.5 py-0.5">2254517</code> 규격</li>
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">홍길동</code> 이름</li>
            <li><code className="rounded bg-slate-200 px-1.5 py-0.5">MBA-039</code> 또는 <code className="rounded bg-slate-200 px-1.5 py-0.5">제네시스</code> 부품</li>
          </ul>
        </div>
      )}

      {result && (
        <>
          <p className="mt-4 text-sm text-slate-500">
            <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-medium text-white">
              {result.label}
            </span>
            <span className="ml-2">
              {result.vehicles.length + result.products.length}건
            </span>
          </p>

          {/* 차량 · 고객 */}
          <ul className="mt-3 space-y-2">
            {result.vehicles.map((v) => (
              <li key={v.vehicleId} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="tabular text-xl font-bold">{v.plateNo}</span>
                  <span className="text-lg">{v.customerName}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {[v.makerName, v.model, v.year ? `${v.year}년` : null].filter(Boolean).join(" · ")}
                </div>
                <div className="tabular mt-1 flex flex-wrap gap-x-4 text-sm text-slate-500">
                  {v.mileage ? <span>{v.mileage.toLocaleString()} km</span> : null}
                  {v.phone ? <span>{v.phone}</span> : <span className="text-amber-600">번호 없음</span>}
                  {v.lastFittedSize ? <span>최근 {v.lastFittedSize}</span> : null}
                </div>
                {v.memo && <div className="mt-1 text-sm text-indigo-700">📝 {v.memo}</div>}
                {v.familyGroupId && (
                  <div className="mt-1 text-xs text-slate-400">같은 번호를 쓰는 고객이 더 있습니다</div>
                )}
              </li>
            ))}
          </ul>

          {/* 상품 · 재고 — 누르면 재고를 고칠 수 있다 */}
          <ul className="mt-3 space-y-2">
            {result.products.map((p) => (
              <Link
                key={p.productId}
                href={`/stock/${p.productId}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* ⭐ 브랜드 + 모델명 + 규격. 고객은 "미쉐린 파일럿스포츠"라고 말한다 */}
                    <div className="truncate font-medium">
                      {p.brandName ? <span className="text-slate-500">{p.brandName} </span> : null}
                      {p.pattern ?? p.name}
                    </div>
                    {p.spec && <div className="tabular mt-0.5 text-sm text-slate-700">{p.spec}</div>}
                    {p.fitment && <div className="mt-0.5 text-sm text-slate-500">{p.fitment}</div>}
                    {p.partNo && <div className="tabular text-xs text-slate-400">{p.partNo}</div>}
                  </div>
                  <StockBadge p={p} />
                </div>
                {p.listPrice ? (
                  <div className="tabular mt-2 text-sm text-slate-600">
                    기표가 {p.listPrice.toLocaleString()}원
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-amber-600">기표가 없음</div>
                )}
              </Link>
            ))}
          </ul>

          {result.vehicles.length + result.products.length === 0 && (
            <div className="mt-8 text-center">
              <p className="text-slate-500">찾지 못했습니다</p>
              <Link
                href={`/product/new?q=${encodeURIComponent(q)}`}
                className="mt-3 inline-block rounded-xl border-2 border-dashed border-slate-300 px-6 py-3 font-medium text-slate-600"
              >
                + 새 상품으로 등록
              </Link>
            </div>
          )}

          {result.products.length > 0 && (
            <div className="mt-4 text-center">
              <Link href={`/product/new?q=${encodeURIComponent(q)}`} className="text-sm text-slate-500 underline underline-offset-4">
                찾는 모델이 없나요? 새 상품 등록
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/**
 * ⭐ 「없다」와 「모른다」를 구분한다 (D-12)
 *   재고 있음  → 🟢 숫자
 *   미등록     → ⚪ 창고를 봐야 한다. 0본이 아니다
 *   미확인     → ⚪ 부품 수량은 실물과 맞지 않는다
 *   소진       → 🔴 정말 없다
 */
function StockBadge({ p }: { p: { stockQty: number; stockTracked: boolean; verified: boolean; itemType: string } }) {
  const unit = p.itemType === "tire" ? "본" : "개";

  if (!p.stockTracked) {
    return (
      <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500">
        ⚪ 미등록
      </span>
    );
  }
  if (!p.verified) {
    return (
      <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500">
        ⚪ 미확인
      </span>
    );
  }
  if (p.stockQty > 0) {
    return (
      <span className="tabular shrink-0 rounded-lg bg-emerald-100 px-3 py-1.5 text-base font-bold text-emerald-800">
        {p.stockQty}
        {unit}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
      0{unit} · 소진
    </span>
  );
}
