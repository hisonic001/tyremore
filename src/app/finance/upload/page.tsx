import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { FinUpload } from "./upload-ui";

export const dynamic = "force-dynamic";

/** ⭐ 돈 관리 — 엑셀 올리기 (ERP 1단계, 2026-08-24). 사장님 전용 */
export default async function FinanceUploadPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  return (
    <FinShell tab="upload">
      <p className="mt-2 text-sm text-slate-500">
        인터넷뱅킹의 거래내역 엑셀, 카드사의 이용내역 엑셀을 그대로 올리시면 됩니다. 월 1~2번이면
        충분합니다.
      </p>
      <FinUpload />
    </FinShell>
  );
}
