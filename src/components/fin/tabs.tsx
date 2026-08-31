import Link from "@/lib/link";

/**
 * ⭐ 돈 관리 탭 바 (ERP 구조화 배치1, 사장님 승인 2026-08-25)
 *
 *   평면 1줄 탭 — 허브의 바로가기 카드 6장을 대체하는 상시 네비.
 *   문법은 설정>상품 탭(bg-slate-100 p-1 + 활성 bg-white shadow-sm)의 정본화.
 *   🔴 탭에 할 일 수 배지를 넣지 않는다 — 매 화면 카운트 질의는 커넥션 풀 낭비.
 *      할 일 수는 「현황」 대시보드가 담당.
 */
export type FinTabId = "home" | "tax" | "card" | "deposits" | "expenses" | "payables" | "party" | "trace" | "upload";

const TABS: { id: FinTabId; href: string; label: string }[] = [
  { id: "home", href: "/finance", label: "현황" },
  { id: "tax", href: "/finance/tax", label: "계산서" },
  { id: "card", href: "/finance/card", label: "카드" },
  { id: "deposits", href: "/finance/deposits", label: "입금" },
  { id: "expenses", href: "/finance/expenses", label: "지출" },
  { id: "payables", href: "/finance/payables", label: "미지급" },
  { id: "party", href: "/finance/party", label: "거래처" },
  /* ⭐ 돈 추적 (근본책 1단계-A, 2026-08-31) — "이 돈 어디 갔어?" */
  { id: "trace", href: "/finance/trace", label: "추적" },
  { id: "upload", href: "/finance/upload", label: "올리기" },
];

/**
 * 🔴 2026 감사 R1(2026-08-26): 탭이 달을 버려 9/1에 8월을 정리하다 탭을 누르면 전 화면이 9월로 튀었다
 *    — 보는 달을 모든 탭에 붙인다 (계산서는 돈 확인 뷰로).
 */
export function FinTabs({ tab, ym }: { tab: FinTabId; ym?: string }) {
  const hrefOf = (t: (typeof TABS)[number]) => {
    if (!ym) return t.href;
    if (t.id === "tax") return `${t.href}?view=money&ym=${ym}`;
    return `${t.href}?ym=${ym}`;
  };
  return (
    <nav className="-mx-4 mt-2 overflow-x-auto px-4">
      <div className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1 lg:min-w-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={hrefOf(t)}
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
