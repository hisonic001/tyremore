import Link from "@/lib/link";

/**
 * ⭐ 돈 관리 탭 바 (ERP 구조화 배치1, 사장님 승인 2026-08-25)
 *
 *   평면 1줄 탭 — 허브의 바로가기 카드 6장을 대체하는 상시 네비.
 *   문법은 설정>상품 탭(bg-slate-100 p-1 + 활성 bg-white shadow-sm)의 정본화.
 *   🔴 탭에 할 일 수 배지를 넣지 않는다 — 매 화면 카운트 질의는 커넥션 풀 낭비.
 *      할 일 수는 「현황」 대시보드가 담당. (거래처 탭은 배치3에서 추가)
 */
export type FinTabId = "home" | "tax" | "card" | "deposits" | "expenses" | "payables" | "upload";

const TABS: { id: FinTabId; href: string; label: string }[] = [
  { id: "home", href: "/finance", label: "현황" },
  { id: "tax", href: "/finance/tax", label: "계산서" },
  { id: "card", href: "/finance/card", label: "카드" },
  { id: "deposits", href: "/finance/deposits", label: "입금" },
  { id: "expenses", href: "/finance/expenses", label: "지출" },
  { id: "payables", href: "/finance/payables", label: "미지급" },
  { id: "upload", href: "/finance/upload", label: "올리기" },
];

export function FinTabs({ tab }: { tab: FinTabId }) {
  return (
    <nav className="-mx-4 mt-2 overflow-x-auto px-4">
      <div className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1 lg:min-w-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-center text-sm font-semibold lg:flex-1 ${
              tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
