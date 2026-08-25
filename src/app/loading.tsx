import { LoaderCircle } from "lucide-react";

/**
 * ⭐ 전역 로딩 (디자인 리프레시 배치1) — prefetch=false 라 화면 전환마다
 *   서버 렌더 대기가 있다. 흰 화면 대신 스피너 (루트 하나로 전 라우트 커버).
 */
export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 text-slate-400">
      <LoaderCircle className="size-8 animate-spin text-brand-600" />
      <p className="text-sm">불러오는 중…</p>
    </main>
  );
}
