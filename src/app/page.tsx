import Link from "@/lib/link";
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
    /** ⭐ 부품 필터 (사장님 지시 2026-08-14) — 기본은 타이어만, 켜면 부품만 */
    parts: sp.parts === "1",
  };
  /** ⭐ 전체 목록 보기 (품목 정리 ① — 기본은 취급 상품 770개만) */
  const all = sp.all === "1";
  /** 현재 검색 조건을 유지한 채 all 만 켜고 끈 주소 */
  const linkWith = (allOn: boolean) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "all" || v === undefined) continue;
      if (typeof v === "string") p.set(k, v);
      else for (const x of v) p.append(k, x);
    }
    if (allOn) p.set("all", "1");
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };
  const filterCount =
    filter.brands.length +
    filter.seasons.length +
    (filter.runflat ? 1 : 0) +
    (filter.acoustic ? 1 : 0) +
    (filter.suv ? 1 : 0) +
    (filter.inStock ? 1 : 0) +
    (filter.parts ? 1 : 0);

  const session = await getSession();
  const [vehicles, products, brands] = await Promise.all([
    mode === "customer" && q ? findVehicles(q) : Promise.resolve([]),
    mode === "product"
      ? // ⭐ 기본은 타이어만 — 「부품」 필터를 켰을 때만 부품이 나온다 (2026-08-14)
        findProducts(q, { ...filter, all, itemType: filter.parts ? "part" : "tire" })
      : Promise.resolve([]),
    mode === "product" ? tireBrands() : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24 lg:max-w-6xl xl:pb-5">
      {/*
        ⚠️ 좁은 화면에서 제목이 「타이어모 / 어」로 줄바꿈되던 문제 (2026-08-01).
           제목은 절대 줄이지 않고(shrink-0 · whitespace-nowrap),
           나머지 메뉴는 설정 아이콘 하나로 접었다.
      */}
      {/* ⭐ 배치2 — 워드마크 헤더. 정비 내역·설정은 전역 탭바(AppNav)로 이동.
            제목 <a>는 홈 초기화용(사장님 요청 2026-08-09), PC는 상단 AppNav 워드마크가 있어 숨긴다 */}
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="shrink-0 whitespace-nowrap text-xl font-extrabold tracking-tight lg:hidden">
          <a href="/">타이어<span className="text-brand-500">모어</span></a>
        </h1>
        <nav className="flex shrink-0 items-center gap-1.5 lg:ml-auto">
          {/* ⭐ 판매 등록이 하루에 가장 자주 쓰는 화면 — 브랜드 초록 CTA */}
          <Link
            href="/sale"
            className="rounded-control bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors active:bg-brand-700 lg:hover:bg-brand-700"
          >
            판매 등록
          </Link>
          <Link
            href="/receiving"
            className="rounded-control px-2.5 py-2 text-sm font-medium text-slate-600 active:bg-slate-200 lg:hover:bg-slate-100"
          >
            매입
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
            {/* PC 는 2열 — 한 화면에 두 배 (사장님 승인 2026-08-08) */}
            <ul className="mt-2 grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
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
          {/* ⭐ 전체 목록 모드 표시 (품목 정리 ①) — 기본은 취급 상품만이다 */}
          {all && (q || filterCount > 0) && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>전체 목록에서 보는 중 — 취급 안 하는 상품도 나옵니다</span>
              <Link href={linkWith(false)} className="font-semibold underline underline-offset-2">
                취급 상품만
              </Link>
            </div>
          )}
          {(q || filterCount > 0) && <Count n={products.length} />}
          {/* PC 는 2열 — 한 화면에 두 배 (사장님 승인 2026-08-08) */}
          <ul className="mt-2 grid grid-cols-1 items-start gap-2 lg:grid-cols-2">
            {products.map((p) => (
              <ProductCard key={p.productId} p={p} />
            ))}
          </ul>
          {/* 취급 상품에서 찾았어도 전체를 열 수 있게 꼬리에 둔다 */}
          {!all && (q || filterCount > 0) && products.length > 0 && (
            <div className="mt-3 text-center">
              <Link href={linkWith(true)} className="text-sm text-slate-500 underline underline-offset-4">
                전체 목록에서 찾기 (취급 안 하는 상품 포함)
              </Link>
            </div>
          )}
          {(q || filterCount > 0) && products.length === 0 && (
            <div className="mt-8 text-center">
              <p className="text-slate-500">{all ? "전체 목록에도 없습니다" : "취급 상품에는 없습니다"}</p>
              {!all && (
                <Link
                  href={linkWith(true)}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-control border border-slate-300 bg-white px-6 font-semibold text-slate-700 transition-colors active:bg-slate-100 lg:hover:bg-slate-50"
                >
                  전체 목록에서 찾기
                </Link>
              )}
              <div className="mt-3">
                <Link
                  href={`/settings/products?tab=new&q=${encodeURIComponent(q)}`}
                  className="text-sm text-slate-500 underline underline-offset-4"
                >
                  + 새 상품으로 등록
                </Link>
              </div>
            </div>
          )}
          {!q && filterCount === 0 && <Hint mode="product" />}
          <ComparePanel />
          {products.length > 0 && (
            <div className="mt-4 text-center">
              <Link
                href={`/settings/products?tab=new&q=${encodeURIComponent(q)}`}
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
        ];
  return (
    <div className="mt-6 space-y-1.5 text-sm text-slate-500">
      {rows.map(([k, v]) => (
        <div key={k}>
          <code className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-800">{k}</code>
          <span className="ml-2">{v}</span>
        </div>
      ))}
      {mode === "product" && (
        // ⭐ 부품은 「부품」 필터를 켜야 나온다 (2026-08-14 분리) — 여기서 알려준다
        <p className="pt-2">
          필터·패드·배터리 같은 <strong className="text-slate-700">부품</strong>은 위의
          「부품」을 켜고 차종·품번(예: <code className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-800">DF80L</code>)으로 찾으세요.
        </p>
      )}
    </div>
  );
}
