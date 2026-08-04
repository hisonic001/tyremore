import Link from "next/link";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { SEASON_STYLE } from "@/lib/tire-attrs";
import { BADGE_STYLE } from "@/lib/tire-name";
import { PriceTool } from "./price-tool";

export function VehicleCard({ v }: { v: VehicleHit }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      {/* 이름이 길어도 번호판이 밀리면 안 된다 — 번호판이 식별의 기준이다 */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="tabular shrink-0 text-xl font-bold">{v.plateNo}</span>
        <span className="truncate text-lg">{v.customerName}</span>
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
      {/*
        ⭐ 정비 이력으로 바로 (사장님 지적 2026-08-04)
           "고객 조회를 해도 과거 정비 이력은 확인이 불가한점."
           손님이 "지난번에 뭐 갈았죠?" 하면 여기서 한 번에 가야 한다.
      */}
      <Link
        href={`/sales?vehicle=${v.vehicleId}`}
        className="mt-2 block rounded-lg border border-slate-300 py-2 text-center text-sm font-medium text-slate-600 active:bg-slate-50"
      >
        이 차의 정비 이력 보기
      </Link>
    </li>
  );
}

/**
 * ⭐ 화면은 깔끔하게, 세부사항은 전부 (사장님 요청 2026-08-01)
 *
 *   [미쉐린] [올웨더]
 *   CROSSCLIMATE 2
 *   215/55R17  98W                        🟢 4본
 *   [흡음재] [XL 하중강화] [MO 벤츠]
 *   CAI 334245              기표가 251,900원 VAT 포함
 *
 * MARS 원본명은 화면에서 빠지지만 `marsName` 으로 그대로 살아 있다 (D-08).
 */
export function ProductCard({ p }: { p: ProductHit }) {
  const unit = p.itemType === "tire" ? "본" : "개";
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      {/* 정보 부분만 링크. 아래 가격 툴은 눌러도 화면이 넘어가면 안 된다 */}
      <Link href={`/stock/${p.productId}`} className="block active:opacity-60">
        {/* 1줄: 브랜드 · 계절 */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {p.brandName && (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {p.brandName}
            </span>
          )}
          {/*
            ⭐ 계절을 모르면 **모른다고 한다** (2026-08-03).
               예전에는 사전에 없는 모델을 전부 「여름」으로 찍어서, 사계절·겨울 타이어까지
               여름으로 나왔다. 누르면 상세 화면에서 바로 고칠 수 있다.
          */}
          {p.season ? (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${SEASON_STYLE[p.season]}`}>
              {p.season}
            </span>
          ) : p.itemType === "tire" ? (
            <span className="rounded border border-dashed border-amber-400 px-2 py-0.5 text-xs font-medium text-amber-700">
              계절 미확인 ✏️
            </span>
          ) : null}
          {p.isHidden && (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">숨김</span>
          )}
        </div>

        {/* 2줄: 모델명 · 규격 · 재고 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg font-bold leading-snug">{p.model}</div>
            <div className="tabular mt-0.5 flex flex-wrap gap-x-3 text-sm text-slate-700">
              {p.spec && <span className="font-medium">{p.spec}</span>}
              {p.loadSpeed && <span>{p.loadSpeed}</span>}
            </div>
            {p.fitment && <div className="mt-0.5 truncate text-sm text-slate-500">{p.fitment}</div>}
          </div>
          <StockBadge p={p} />
        </div>

        {/* 3줄: 세부사항 — 런플랫·흡음재·OE마킹 등 전부 */}
        {(p.badges.length > 0 || p.unknown.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.badges.map((b) => (
              <span
                key={b.code}
                className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE_STYLE[b.kind]}`}
              >
                {b.code === b.label ? b.code : `${b.code} ${b.label}`}
              </span>
            ))}
            {/* 사전에 없는 표기도 버리지 않는다 */}
            {p.unknown.map((u) => (
              <span key={u} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-400">
                {u}
              </span>
            ))}
          </div>
        )}

        {/* 4줄: CAI · 기표가 */}
        <div className="tabular mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-xs text-slate-400">
            {p.cai && (
              <>
                CAI <span className="font-semibold text-slate-600">{p.cai}</span>
              </>
            )}
            {p.partNo && <span className="ml-2">{p.partNo}</span>}
          </span>
          <span className="text-sm">
            {p.listPrice ? (
              <>
                <span className="text-slate-500">기표가 </span>
                <span className="font-semibold text-slate-700">{p.listPrice.toLocaleString()}원</span>
                <span className="ml-1 text-xs text-slate-400">VAT 포함</span>
              </>
            ) : (
              <span className="text-amber-600">기표가 없음</span>
            )}
          </span>
        </div>
      </Link>

      {/* ⭐ 목록에서 바로 계산한다. 상품을 눌러 들어갔다 나오는 왕복을 없앤다 */}
      {p.listPrice !== null && (
        <PriceTool
          productId={p.productId}
          model={p.model}
          spec={p.spec}
          brandName={p.brandName}
          listPrice={p.listPrice}
          salesRate={p.salesRate}
          unit={unit}
        />
      )}
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
