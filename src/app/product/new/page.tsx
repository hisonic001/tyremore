import Link from "next/link";
import { db } from "@/db";
import { brand } from "@/db/schema";
import { asc } from "drizzle-orm";
import { NewProductForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * 새 상품 등록 — MARS 마스터에 없는 신모델용 (사장님 요청 2026-08-01)
 *
 * MARS 상품 마스터에 10,691건이 이미 있으므로 대부분은 검색으로 나온다.
 * 여기는 **정말 새로 나온 모델**을 넣는 자리다.
 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const brands = await db
    .select({ code: brand.code, nameKo: brand.nameKo })
    .from(brand)
    .orderBy(asc(brand.sortOrder));

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">새 상품 등록</h1>
      <p className="mt-1 text-sm text-slate-500">
        MARS 마스터에 없는 신모델만 여기서 넣습니다. 대부분은 검색으로 나옵니다.
      </p>

      <NewProductForm brands={brands} initialPattern={q ?? ""} />
    </main>
  );
}
