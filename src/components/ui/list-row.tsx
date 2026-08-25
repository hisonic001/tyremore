import type { ReactNode } from "react";
import Link from "@/lib/link";

/**
 * ⭐ 리스트 행 정본 (디자인 리프레시 배치1) — 토스 거래 리스트 문법
 *
 *   [원형 아이콘] 제목/보조설명 ·············· 금액(bold)/부가라벨
 *   홈 검색 결과·정비 내역·입출금·원장이 이 문법으로 수렴한다.
 */
const ROW =
  "flex w-full items-center gap-3 rounded-control px-1.5 py-3 text-left transition-colors " +
  "active:bg-slate-100 lg:hover:bg-slate-50";

function Inner({
  icon,
  title,
  sub,
  right,
  rightSub,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
}) {
  return (
    <>
      {icon && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug">{title}</span>
        {sub && <span className="block truncate text-[13px] leading-snug text-slate-500">{sub}</span>}
      </span>
      {(right || rightSub) && (
        <span className="shrink-0 text-right">
          {right && <span className="tabular block font-bold leading-snug">{right}</span>}
          {rightSub && <span className="block text-xs leading-snug text-slate-400">{rightSub}</span>}
        </span>
      )}
    </>
  );
}

export function ListRow(props: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  href?: string;
}) {
  if (props.href) {
    return (
      <Link href={props.href} className={ROW}>
        <Inner {...props} />
      </Link>
    );
  }
  return (
    <div className={ROW}>
      <Inner {...props} />
    </div>
  );
}
