import type { ReactNode } from "react";
import { Check, CircleAlert, Info, LoaderCircle, TriangleAlert } from "lucide-react";

/**
 * ⭐ 인라인 알림 정본 (디자인 리프레시 배치1) — Toast 대신 그 자리 메시지 통일.
 *   (시선 이동 없는 인라인이 1~2인 매장 사용에 더 낫다는 설계 결정)
 */
const TONE = {
  success: { cls: "bg-brand-50 text-brand-700", Icon: Check },
  error: { cls: "bg-red-50 text-red-700", Icon: CircleAlert },
  warn: { cls: "bg-amber-50 text-amber-900", Icon: TriangleAlert },
  info: { cls: "bg-sky-50 text-sky-900", Icon: Info },
} as const;

export function Notice({ tone, children, className }: { tone: keyof typeof TONE; children: ReactNode; className?: string }) {
  const { cls, Icon } = TONE[tone];
  return (
    <p className={`mt-2 flex items-start gap-1.5 rounded-control p-2.5 text-sm leading-snug ${cls} ${className ?? ""}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  return <LoaderCircle className={`animate-spin text-brand-600 ${size === "sm" ? "size-5" : "size-8"}`} />;
}
