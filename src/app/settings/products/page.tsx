import Link from "@/lib/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schema";
import { isOwner } from "@/lib/auth";
import { catalogStats } from "@/lib/catalog";
import { listReaders } from "@/lib/product-list";
import { BrandToggle, BulkActions } from "./brand-controls";
import { ProductListUpload } from "./upload-ui";
import { NewProductForm } from "./new-form";
import { ProductLookup } from "./lookup";
import { duplicateGroups } from "@/lib/product-merge";
import { DupList } from "./dup-list";

export const dynamic = "force-dynamic";

/**
 * ⭐ 상품 — 한 화면 (사장님 지시 2026-08-04)
 *
 *   "지금 기능이 전반적으로 산만해보이는데"
 *
 * 상품에 관한 일이 세 곳에 흩어져 있었다.
 *   /settings/catalog       안 받는 것 숨기기
 *   /settings/product-list  거래처 목록으로 채우기
 *   /product/new            한 건씩 손으로
 * 셋 다 「상품 목록을 손보는 일」이다. 한 화면 안의 탭 세 개로 접는다.
 *
 * 🔴 앞 세션(`cc6dd0e`)에서 설정 **메뉴만** 세 묶음으로 접고 화면 개수는 그대로 뒀다.
 *    그건 반쪽이었다 — 화면 수까지 줄여야 산만함이 실제로 없어진다.
 *
 * ⚠️ `/product/new?q=...` 는 홈 검색이 빈손일 때 들어오는 입구다.
 *    `?tab=new&q=...` 로 그대로 받는다 (옛 주소는 리다이렉트로 살려 둔다).
 */
const TABS = [
  { id: "fill", label: "목록 채우기" },
  { id: "new", label: "새 상품" },
  { id: "hide", label: "안 받는 것 숨기기" },
  { id: "dup", label: "중복 합치기" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  /** ⭐ 재고 화면의 「새 부품 등록」이 부품 칸을 열어 둔 채로 들어온다 (2026-08-14) */
  const type: "tire" | "part" = sp.type === "part" ? "part" : "tire";
  // 검색에서 「새 상품 등록」으로 들어오면 그 탭이 열려 있어야 한다
  const tab: TabId = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : q ? "new" : "fill";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-xl font-bold">상품</h1>
      <p className="mt-1 text-sm text-slate-500">
        검색에 나오는 상품 목록을 손봅니다.
      </p>

      <nav className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings/products?tab=${t.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold ${
              tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "fill" && <FillTab />}
      {tab === "new" && <NewTab q={q} type={type} />}
      {tab === "hide" && <HideTab />}
      {tab === "dup" && <DupTab />}
    </main>
  );
}

/* ============================================================
 * ④ 중복 합치기 ⭐ (사장님 승인 2026-08-05 — 품목 정리 ②)
 *    같은 타이어가 상품 두세 개로 갈라진 것을 대표 하나로 모은다.
 * ========================================================== */
async function DupTab() {
  if (!(await isOwner())) {
    return (
      <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        이력을 옮기는 기능이라 <strong>사장님만</strong> 쓸 수 있습니다.
      </p>
    );
  }
  const groups = await duplicateGroups();
  return <DupList groups={groups} />;
}

/* ============================================================
 * ① 목록 채우기 — 거래처가 준 상품목록 엑셀
 * ========================================================== */
async function FillTab() {
  if (!(await isOwner())) {
    return (
      <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
        기표가를 고치는 기능이 들어 있어 <strong>사장님만</strong> 쓸 수 있습니다.
      </p>
    );
  }

  const readers = await listReaders();
  const stats = await db.execute<{ linked: number }>(
    sql`SELECT count(*)::int linked FROM supplier_item_code`,
  );
  const [tires] = await db.execute<{ total: number; noSeason: number }>(sql`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE season IS NULL)::int "noSeason"
    FROM product
    WHERE item_type = 'tire' AND is_active AND brand_code = 'KM'`);

  return (
    <>
      <p className="mt-4 text-sm text-slate-500">
        거래처가 준 상품목록을 올리면 <strong>인보이스가 알아보고, 타이어 검색에도 함께 채웁니다.</strong>
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="검색에 나오는 금호" n={tires.total} />
        <Stat label="거래처 품번 이어짐" n={Number(stats[0]?.linked ?? 0)} />
        <Stat label="계절 미확인" n={tires.noSeason} tone={tires.noSeason ? "amber" : undefined} />
      </dl>
      {tires.noSeason > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          계절 미확인은 거래처가 모델 이름 없이 <strong>패턴코드만</strong> 적어 보내는 것들입니다 (PA71 ·
          KL78 같은 것). 짐작으로 이름을 붙이지 않습니다 — 상품 화면에서 고쳐 주시면 그대로 남습니다.
        </p>
      )}

      <ProductListUpload readers={readers} />

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        같은 타이어인데 금호는 <span className="tabular">2387392</span>, 우리는{" "}
        <span className="tabular">KM2284552</span> 로 부릅니다. 그래서 인보이스를 올려도 &ldquo;상품
        미등록&rdquo;으로 뜨던 것을 이 목록으로 짝지어 둡니다. 우리 품번은{" "}
        <strong>바꾸지 않습니다</strong> — MARS 에 넣을 때 쓰는 값이라 그대로 두어야 합니다.
      </p>
    </>
  );
}

/* ============================================================
 * ② 새 상품 — 한 건씩 손으로
 * ========================================================== */
async function NewTab({ q, type }: { q: string; type: "tire" | "part" }) {
  const brands = await db
    .select({ code: brand.code, nameKo: brand.nameKo })
    .from(brand)
    .orderBy(asc(brand.sortOrder));

  return (
    <>
      <p className="mt-4 text-sm text-slate-500">
        목록에 없는 <strong>정말 새 물건</strong>만 여기서 넣습니다 — 새 타이어 모델, 새로 들이는
        부품(배터리·필터·패드 등).
      </p>

      {/* ⭐ 만들기 전에 먼저 찾아본다 — 중복으로 만들면 재고가 갈라진다 */}
      <ProductLookup initial={q} />

      <div className="mt-8 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-sm text-slate-400">정말 없으면 아래에 등록</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <NewProductForm brands={brands} initialPattern={q} initialType={type} />
    </>
  );
}

/* ============================================================
 * ③ 안 받는 것 숨기기
 * ========================================================== */
async function HideTab() {
  const s = await catalogStats();

  return (
    <>
      <p className="mt-4 text-sm text-slate-500">
        안 받는 브랜드와 못 파는 상품을 화면에서 치웁니다.{" "}
        <strong className="text-slate-700">지우는 것이 아니라 끄는 것</strong>이라 나중에 입고하실 때
        그대로 되살아납니다.
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="전체" n={s.totals.all} />
        <Stat label="보이는 것" n={s.totals.visible} tone="green" />
        <Stat label="숨긴 것" n={s.totals.hidden} tone="gray" />
      </dl>

      <BulkActions hidden={s.hidden} />

      <section className="mt-6">
        <h2 className="mb-1 font-semibold">취급 브랜드</h2>
        <p className="mb-3 text-sm text-slate-500">
          끄면 검색 결과에서 통째로 빠집니다. <strong>재고가 있는 브랜드는 끄지 마세요.</strong>
        </p>
        <ul className="space-y-2">
          {s.brands.map((b) => (
            <BrandToggle key={b.code} b={b} />
          ))}
        </ul>
      </section>
    </>
  );
}

function Stat({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone?: "green" | "gray" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-emerald-700"
      : tone === "gray"
        ? "text-slate-400"
        : tone === "amber"
          ? "text-amber-700"
          : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`tabular mt-0.5 text-xl font-bold ${color}`}>{n.toLocaleString()}</dd>
    </div>
  );
}
