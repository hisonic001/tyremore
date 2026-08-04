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

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">금호 상품목록</h1>
      <p className="mt-1 text-sm text-slate-500">
        금호 인보이스에 찍히는 <strong>자재코드</strong>와 우리 품번을 이어 둡니다. 지금{" "}
        <strong className="tabular">{dict}개</strong> 이어져 있습니다.
      </p>

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
