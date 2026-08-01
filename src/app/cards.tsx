import Link from "next/link";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { SEASON_STYLE } from "@/lib/tire-attrs";

export function VehicleCard({ v }: { v: VehicleHit }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
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
  );
}

export function ProductCard({ p }: { p: ProductHit }) {
  return (
    <li>
      <Link
        href={`/stock/${p.productId}`}
        className="block rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-50"
      >
        {/* 태그 줄 — 계절과 특성이 한눈에 */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {p.brandName && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {p.brandName}
            </span>
          )}
          {p.season && (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${SEASON_STYLE[p.season]}`}>
              {p.season}
            </span>
          )}
          {p.isRunflat && (
            <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">런플랫</span>
          )}
          {p.isAcoustic && (
            <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">흡음재</span>
          )}
          {p.isSuv && (
            <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">SUV</span>
          )}
          {/* OE 마킹 — 어느 차 순정인가. 같은 모델이라도 마킹이 다르면 다른 물건이다 */}
          {p.oe.map((m) => (
            <span key={m} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
              {m}
            </span>
          ))}
          {p.isHidden && (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">숨김</span>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              ⭐ 전체 이름을 그대로 보여준다 (사장님 요청 2026-08-01).
              모델명만 띄우면 같은 PILOT SPORT 4 S 세 건이 똑같이 보인다.
              XL·ZR·TL·OE마킹이 다른 물건이다.
            */}
            <div className="text-base font-semibold leading-snug">{p.fullName}</div>
            {p.fitment && <div className="mt-0.5 truncate text-sm text-slate-500">{p.fitment}</div>}
            <div className="tabular mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
              {p.cai && (
                <span>
                  CAI <span className="font-semibold text-slate-600">{p.cai}</span>
                </span>
              )}
              {p.partNo && <span>{p.partNo}</span>}
            </div>
          </div>
          <StockBadge p={p} />
        </div>

        <div className="tabular mt-2 text-sm">
          {p.listPrice ? (
            <>
              <span className="text-slate-500">공장도 </span>
              <span className="text-base font-bold text-slate-900">{p.listPrice.toLocaleString()}원</span>
            </>
          ) : (
            <span className="text-amber-600">공장도가 없음</span>
          )}
        </div>
      </Link>
    </li>
  );
}

/**
 * ⭐ 「없다」와 「모른다」를 구분한다 (D-12)
 *   미등록 → 창고를 봐야 한다. 0본이 아니다
 *   미확인 → 부품 수량은 실물과 맞지 않는다
 */
function StockBadge({ p }: { p: ProductHit }) {
  const unit = p.itemType === "tire" ? "본" : "개";
  const gray = "shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-500";

  if (!p.stockTracked) return <span className={gray}>⚪ 미등록</span>;
  if (!p.verified) return <span className={gray}>⚪ 미확인</span>;
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
