import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { marsReportTechAllowed } from "@/lib/mars-eval";
import { listUsers } from "@/lib/user-admin";
import { MarsReportToggle, NewAccount, UserCard } from "./client";

export const dynamic = "force-dynamic";

/**
 * ⭐ 계정 관리 — 사장님 전용 (사장님 요청 2026-08-08)
 *
 * 공개 가입은 없다 — 고객 실명·전화가 든 앱이라 계정은 여기서만 만든다.
 * 비밀번호 「찾기」도 여기의 재설정이 맡는다 (정비사 → 사장님께 요청).
 */
export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/settings");

  const users = (await listUsers()) ?? [];
  const marsAllowed = await marsReportTechAllowed();

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-xl font-bold">계정 관리</h1>
      <p className="mt-1 text-sm text-slate-500">
        계정을 만들고, 역할(사장님/정비사)을 정하고, 비밀번호를 재설정합니다.
      </p>

      <ul className="mt-4 space-y-2">
        {users.map((u) => (
          <UserCard key={u.id} u={u} />
        ))}
      </ul>

      <NewAccount />

      {/* ⭐ MARS 평가 리포트 정비사 열람 (사장님 요청 2026-08-10) */}
      <MarsReportToggle allowed={marsAllowed} />

      <div className="mt-6 space-y-1 text-xs text-slate-400">
        <p>· 사장님 역할은 매입가·마진·리포트·가격 변경·계정 관리를 볼 수 있습니다.</p>
        <p>· 비밀번호를 잊은 직원은 여기서 재설정해 알려 주세요.</p>
        <p>· 마지막 남은 사장님 계정은 내리거나 중지할 수 없습니다 (잠금 방지).</p>
      </div>
    </main>
  );
}
