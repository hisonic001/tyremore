import Link from "next/link";
import { getShopInfo } from "@/lib/shop";
import { ShopForm } from "./form";

export const dynamic = "force-dynamic";

/** ⭐ 가게 정보 — 견적서·거래명세서의 공급자 칸 (사장님 요청 2026-08-05) */
export default async function ShopPage() {
  const info = await getShopInfo();
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">가게 정보</h1>
      <p className="mt-1 text-sm text-slate-500">
        견적서·거래명세서의 <strong>공급자</strong> 칸에 그대로 찍힙니다.
      </p>
      <ShopForm info={info} />
    </main>
  );
}
