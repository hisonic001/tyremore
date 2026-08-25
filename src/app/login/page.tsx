import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // 이미 로그인돼 있으면 바로 들여보낸다
  if (await getSession()) redirect(next && next.startsWith("/") ? next : "/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">
        타이어<span className="text-brand-500">모어</span>
      </h1>
      <p className="mt-1 text-slate-500">재고·상담·견적</p>
      <LoginForm next={next} />
      {/* ⭐ 비밀번호 찾기의 매장 방식 (2026-08-08) — 이메일 발송 대신 사장님 재설정 */}
      <p className="mt-6 text-xs text-slate-400">
        비밀번호를 잊으셨나요? 사장님께 재설정을 요청하세요 (설정 → 계정 관리).
      </p>
      <p className="mt-2 text-xs text-slate-400">
        고객 정보가 들어 있습니다. 매장 밖에서는 화면을 켜 두지 마세요.
      </p>
    </main>
  );
}
