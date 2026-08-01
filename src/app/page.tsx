import Link from "next/link";
import { findProducts, findVehicles, guessMode, tireBrands, type Mode } from "@/lib/search";
import type { Season } from "@/lib/tire-attrs";
import { FilterPanel, ModeTabs } from "./search-ui";
import { ProductCard, VehicleCard } from "./cards";

export const dynamic = "force-dynamic";

function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : v.split(",").filter(Boolean);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";

  /**
   * 버튼으로 고른 모드가 이긴다. 안 골랐으면 입력을 보고 정한다.
   * ⭐ 기본은 「타이어·재고」다 (사장님 요청 2026-08-01).
   *    상담 중 가장 자주 여는 것이 재고·가격이다. 고객 조회는 그다음.
   */
  const picked = sp.mode === "customer" || sp.mode === "product" ? (sp.mode as Mode) : null;
  const mode: Mode = picked ?? guessMode(q) ?? "product";

  const filter = {
    brands: arr(sp.brand),
    seasons: arr(sp.season) as Season[],
    runflat: sp.rf === "1",
    acoustic: sp.ac === "1",
    suv: sp.suv === "1",
    inStock: sp.stock === "1",
  };
  const filterCount =
    filter.brands.length +
    filter.seasons.length +
    (filter.runflat ? 1 : 0) +
    (filter.acoustic ? 1 : 0) +
    (filter.suv ? 1 : 0) +
    (filter.inStock ? 1 : 0);

  const [vehicles, products, brands] = await Promise.all([
    mode === "customer" && q ? findVehicles(q) : Promise.resolve([]),
    mode === "product" ? findProducts(q, filter) : Promise.resolve([]),
    mode === "product" ? tireBrands() : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight">타이어모어</h1>
        <nav className="flex gap-3 text-sm text-slate-500">
          <Link href="/settings/catalog" className="underline underline-offset-4">
            상품 정리
          </Link>
          <Link href="/status" className="underline underline-offset-4">
            이관 현황
          </Link>
        </nav>
      </header>

      <ModeTabs mode={mode} q={q} />

      <form action="/" method="get" className="mt-3">
        <input type="hidden" name="mode" value={mode} />
        {mode === "product" && (
          <>
            {filter.brands.map((b) => <input key={b} type="hidden" name="brand" value={b} />)}
            {filter.seasons.map((s) => <input key={s} type="hidden" name="season" value={s} />)}
            {filter.runflat && <input type="hidden" name="rf" value="1" />}
            {filter.acoustic && <input type="hidden" name="ac" value="1" />}
            {filter.suv && <input type="hidden" name="suv" value="1" />}
            {filter.inStock && <input type="hidden" name="stock" value="1" />}
          </>
        )}
        <input
          name="q"
          defaultValue={q}
          autoFocus
          autoComplete="off"
          placeholder={mode === "customer" ? "차량번호 · 전화 · 이름" : "규격 2254517 · 모델명 · 부품"}
          aria-label="검색"
          className="w-full rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-2xl
                     shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900"
        />
      </form>

      {mode === "product" && (
        <FilterPanel brands={brands} q={q} filter={filter} count={filterCount} />
      )}

      {/* ---- 결과 ---- */}
      {mode === "customer" ? (
        q ? (
          <>
            <Count n={vehicles.length} />
            <ul className="mt-2 space-y-2">
              {vehicles.map((v) => (
                <VehicleCard key={v.vehicleId} v={v} />
              ))}
            </ul>
            {vehicles.length === 0 && <Empty text="찾지 못했습니다" />}
          </>
        ) : (
          <Hint mode="customer" />
        )
      ) : (
        <>
          {(q || filterCount > 0) && <Count n={products.length} />}
          <ul className="mt-2 space-y-2">
            {products.map((p) => (
              <ProductCard key={p.productId} p={p} />
            ))}
          </ul>
          {(q || filterCount > 0) && products.length === 0 && (
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
          {!q && filterCount === 0 && <Hint mode="product" />}
          {products.length > 0 && (
            <div className="mt-4 text-center">
              <Link
                href={`/product/new?q=${encodeURIComponent(q)}`}
                className="text-sm text-slate-500 underline underline-offset-4"
              >
                찾는 모델이 없나요? 새 상품 등록
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Count({ n }: { n: number }) {
  return <p className="mt-4 text-sm text-slate-500">{n}건{n >= 60 && " 이상 (좁혀 보세요)"}</p>;
}

function Empty({ text }: { text: string }) {
  return <p className="mt-8 text-center text-slate-500">{text}</p>;
}

function Hint({ mode }: { mode: Mode }) {
  const rows =
    mode === "customer"
      ? [
          ["12가3456", "차량번호 전체"],
          ["3456", "뒷 4자리만 — 고객은 이렇게 말합니다"],
          ["010…", "전화번호"],
          ["홍길동", "이름 (메모도 같이 찾습니다)"],
          ["G80", "차종"],
        ]
      : [
          ["2254517", "규격 — 구분자 없이 7자리"],
          ["225/45R17", "규격 — 구분자 있어도 됩니다"],
          ["304349", "CAI — 미쉐린 고유번호"],
          ["PILOT SPORT", "모델명"],
          ["MBA-039", "부품번호"],
          ["제네시스", "부품 적용차종"],
        ];
  return (
    <div className="mt-6 space-y-1.5 text-sm text-slate-500">
      {rows.map(([k, v]) => (
        <div key={k}>
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-800">{k}</code>
          <span className="ml-2">{v}</span>
        </div>
      ))}
    </div>
  );
}
