import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinUpload } from "./upload-ui";

export const dynamic = "force-dynamic";

/** ⭐ 돈 관리 — 엑셀 올리기 (ERP 1단계, 2026-08-24). 사장님 전용 */
export default async function FinanceUploadPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">내역 올리기</h1>
        <Link href="/finance" className="text-sm text-slate-600 underline underline-offset-4">
          ← 돈 관리로
        </Link>
      </header>
      <p className="text-sm text-slate-500">
        인터넷뱅킹의 거래내역 엑셀, 카드사의 이용내역 엑셀을 그대로 올리시면 됩니다. 월 1~2번이면
        충분합니다.
      </p>
      <FinUpload />
    </main>
  );
}
