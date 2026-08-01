import Link from "next/link";
import { catalogStats } from "@/lib/catalog";
import { BrandToggle, BulkActions } from "./controls";

export const dynamic = "force-dynamic";

/**
 * 상품 목록 정리 (사장님 요청 2026-08-01)
 * 안 받는 브랜드를 끄고, 가격 없는 단종품을 치운다. 지우지 않으므로 언제든 되살린다.
 */
export default async function CatalogPage() {
  const s = await catalogStats();

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">상품 목록 정리</h1>
      <p className="mt-1 text-sm text-slate-500">
        안 받는 브랜드와 못 파는 상품을 화면에서 치웁니다.{" "}
        <strong className="text-slate-700">지우는 것이 아니라 끄는 것</strong>이라
        나중에 입고하실 때 그대로 되살아납니다.
      </p>

      <section className="mt-5 grid grid-cols-3 gap-2 text-center">
        <Stat label="전체" n={s.totals.all} />
        <Stat label="보이는 것" n={s.totals.visible} tone="green" />
        <Stat label="숨긴 것" n={s.totals.hidden} tone="gray" />
      </section>

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
    </main>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone?: "green" | "gray" }) {
  const color =
    tone === "green" ? "text-emerald-700" : tone === "gray" ? "text-slate-400" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white py-3">
      <div className={`tabular text-2xl font-bold ${color}`}>{n.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
