import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isOwner } from "@/lib/auth";
import { KumhoCatalog } from "./catalog-ui";

export const dynamic = "force-dynamic";

/**
 * 금호 상품목록 (자재검색) 들이기 ⭐ (사장님 제공 2026-08-04)
 *
 *   "금호타이어 상품목록 대부분을 통합자동화 폴더에 넣어놓음"
 *
 * 금호 인보이스에는 **금호 자재코드**가 찍혀 나오는데 우리 품번은 MARS 것이라
 * 같은 타이어인데도 못 알아봤다. 이 목록이 그 둘을 이어 주는 사전이 된다.
 *
 * ⚠️ 기표가를 고칠 수 있어 사장님만 들어온다.
 */
export default async function KumhoPage() {
  const owner = await isOwner();

  if (!owner) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
        <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
          ← 설정으로
        </Link>
        <h1 className="mt-3 text-2xl font-bold">금호 상품목록</h1>
        <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          기표가를 고치는 기능이 들어 있어 <strong>사장님만</strong> 쓸 수 있습니다.
        </p>
      </main>
    );
  }

  const [{ n: dict }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM supplier_item_code WHERE supplier = '금호'`,
  );
  /** 검색에 실제로 나오는 금호 타이어 — 올린 만큼 여기가 늘어난다 */
  const [tires] = await db.execute<{ total: number; noSeason: number }>(sql`
    SELECT count(*)::int total,
           count(*) FILTER (WHERE season IS NULL)::int "noSeason"
    FROM product
    WHERE item_type = 'tire' AND is_active AND brand_code = 'KM'`);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">금호 상품목록</h1>
      <p className="mt-1 text-sm text-slate-500">
        인보이스가 알아보게 하고, <strong>타이어 검색에도 함께 채웁니다.</strong>
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <dt className="text-xs text-slate-500">검색에 나오는 금호</dt>
          <dd className="tabular mt-0.5 text-xl font-bold">{tires.total}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <dt className="text-xs text-slate-500">자재코드 이어짐</dt>
          <dd className="tabular mt-0.5 text-xl font-bold">{dict}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <dt className="text-xs text-slate-500">계절 미확인</dt>
          <dd className={`tabular mt-0.5 text-xl font-bold ${tires.noSeason ? "text-amber-700" : ""}`}>
            {tires.noSeason}
          </dd>
        </div>
      </dl>
      {tires.noSeason > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          계절 미확인은 금호가 모델 이름 없이 <strong>패턴코드만</strong> 적어 보내는 것들입니다 (PA71 · KL78
          같은 것). 짐작으로 이름을 붙이지 않습니다 — 상품 화면에서 고쳐 주시면 그대로 남습니다.
        </p>
      )}

      <KumhoCatalog />

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        같은 타이어인데 금호는 <span className="tabular">2387392</span>, 우리는{" "}
        <span className="tabular">KM2284552</span> 로 부릅니다. 그래서 인보이스를 올려도 &ldquo;상품
        미등록&rdquo;으로 뜨던 것을, 이 목록으로 짝지어 둡니다. 우리 품번은 <strong>바꾸지 않습니다</strong> —
        MARS 에 넣을 때 쓰는 값이라 그대로 두어야 합니다.
      </p>
    </main>
  );
}
