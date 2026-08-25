import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "@/lib/link";

/**
 * ⭐ 페이지 셸·헤더 정본 (디자인 리프레시 배치1)
 *
 *   PageShell — main 컨테이너 11종을 4종으로 수렴. pb-24는 하단 탭바·FAB 자리.
 *   PageHeader — 뒤로가기 22곳 문구를 「← 목적지」로 표준화, h1 = text-xl 단일.
 *     sticky + backdrop-blur (상용 앱 문법). lg에선 상단 네비(h-12) 아래로.
 */
const WIDTH = {
  sm: "max-w-sm",
  md: "max-w-2xl",
  lg: "max-w-3xl lg:max-w-6xl",
  xl: "max-w-6xl",
} as const;

export function PageShell({
  width = "md",
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={`mx-auto min-h-dvh w-full ${WIDTH[width]} px-4 py-5 pb-24 ${className ?? ""}`}>
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  back,
  action,
  sticky = true,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
  sticky?: boolean;
}) {
  return (
    <header
      className={`-mx-4 mb-2 flex items-center justify-between gap-2 border-b border-slate-100 bg-white/85 px-4 py-3 backdrop-blur ${
        sticky ? "sticky top-0 z-10 lg:top-12" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-1">
        {back && (
          <Link
            href={back.href}
            aria-label={`${back.label}(으)로 돌아가기`}
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100 lg:hover:bg-slate-100"
          >
            <ArrowLeft className="size-5" />
          </Link>
        )}
        <h1 className="truncate text-xl font-bold">{title}</h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
