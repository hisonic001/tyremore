import Link from "next/link";
import { getSession } from "@/lib/auth";
import { findProducts, findVehicles, guessMode, tireBrands, type Mode } from "@/lib/search";
import type { Season } from "@/lib/tire-attrs";
import { SearchBox, SearchButton } from "./search-box";
import { FilterPanel, ModeTabs } from "./search-ui";
import { ProductCard, VehicleCard } from "./cards";
import { ComparePanel } from "./compare-panel";

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

  const session = await getSession();
  const [vehicles, products, brands] = await Promise.all([
    mode === "customer" && q ? findVehicles(q) : Promise.resolve([]),
    mode === "product" ? findProducts(q, filter) : Promise.resolve([]),
    mode === "product" ? tireBrands() : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 xl:pb-5">
      {/*
        ⚠️ 좁은 화면에서 제목이 「타이어모 / 어」로 줄바꿈되던 문제 (2026-08-01).
           제목은 절대 줄이지 않고(shrink-0 · whitespace-nowrap),
           나머지 메뉴는 설정 아이콘 하나로 접었다.
      */}
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="shrink-0 whitespace-nowrap text-xl font-bold tracking-tight">타이어모어</h1>
        <nav className="flex shrink-0 items-center gap-1">
          <Link
            href="/receiving"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 active:bg-slate-200"
          >
            매입 입고
          </Link>
          <Link
            href="/settings"
            aria-label="설정"
            className="rounded-lg px-2 py-2 text-slate-500 active:bg-slate-200"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </nav>
      </header>

      <ModeTabs mode={mode} q={q} />

      <SearchBox mode={mode} q={q} filter={filter} />

      {mode === "product" ? (
        <FilterPanel brands={brands} q={q} filter={filter} count={filterCount} />
      ) : (
        /* 고객 모드에도 조회 버튼은 있어야 한다 */
        <div className="mt-3 flex justify-end">
          <SearchButton />
        </div>
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
          <ComparePanel />
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
