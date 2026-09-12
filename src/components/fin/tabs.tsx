import Link from "@/lib/link";
import { W } from "@/lib/fin-words";

/**
 * ⭐ 돈 관리 탭 바 — 3그룹 + 소탭 2줄 (사장님 선택 2026-09-10 「탭만 3개로 묶기」)
 *
 *   사장님: "탭이 너무 많음 · 무엇부터 할지 모름". 고른 안은 **「지금 구조는 그대로 두고
 *   탭 이름만 정리」** — 화면 내용은 옮기지 않고, 9개를 세 묶음으로 나눠 1줄째에 묶음,
 *   2줄째에 그 묶음의 화면을 보여 준다. 주소(URL)는 전부 그대로다 — 즐겨찾기·딥링크가 안 깨진다.
 *
 *     [할 일]  현황 · 입금 · 계산서 · 지출 · 최근 한 일
 *     [장부]   거래처 · 미지급 · 받을 돈(외상 장부 /receivables) · 추적
 *     [자료]   올리기 · 올린 자료 · 카드 마감
 *
 *   문법은 설정>상품 탭(bg-slate-100 p-1 + 활성 bg-white shadow-sm)의 정본화.
 *   🔴 탭에 할 일 수 배지를 넣지 않는다 — 매 화면 카운트 질의는 커넥션 풀 낭비.
 *      할 일 수는 「현황」 대시보드가 담당.
 */
export type FinTabId =
  | "home" | "tax" | "card" | "deposits" | "expenses" | "payables" | "party" | "trace" | "upload"
  /** ⭐ 올린 자료 (2026-09-10) */
  | "files"
  /** ⭐ 장부 첫 화면 — 손익·근거·마감 (2026-09-11 개편 1단계) */
  | "ledger"
  /** ⭐ 최근 한 일 — 되돌리기 한 곳 (2026-09-12 개편 2단계, 사장님 결정 14) */
  | "activity"
  /** ⭐ 이번 주 정리 — 한 줄 흐름 (2026-09-12 개편 3단계, 사장님 결정 11) */
  | "weekly";

type Tab = { id: FinTabId | "receivables"; href: string; label: string; external?: boolean };
type Group = { id: "todo" | "book" | "data"; label: string; tabs: Tab[] };

const GROUPS: Group[] = [
  {
    id: "todo",
    label: "할 일",
    tabs: [
      { id: "home", href: "/finance", label: "현황" },
      /* 탭 링크는 ?ym= 만 붙는다(hrefOf) — 흐름은 첫 미완 단계부터 (의도) */
      { id: "weekly", href: "/finance/weekly", label: W.weekly },
      { id: "deposits", href: "/finance/deposits", label: "입금 정리" },
      { id: "tax", href: "/finance/tax", label: "계산서" },
      { id: "expenses", href: "/finance/expenses", label: "지출" },
      { id: "activity", href: "/finance/activity", label: W.activity },
    ],
  },
  {
    id: "book",
    label: "장부",
    tabs: [
      { id: "ledger", href: "/finance/ledger", label: "손익" },
      { id: "party", href: "/finance/party", label: "거래처" },
      { id: "payables", href: "/finance/payables", label: "미지급" },
      /* 외상 장부는 돈관리 밖 화면이다 — 「받을 돈」 자리에서 바로 가게 (사장님 모형 그대로) */
      { id: "receivables", href: "/receivables", label: W.receivable, external: true },
      /* ⭐ 돈 추적 (근본책 1단계-A, 2026-08-31) — "이 돈 어디 갔어?" */
      { id: "trace", href: "/finance/trace", label: "추적" },
    ],
  },
  {
    id: "data",
    label: "자료",
    tabs: [
      { id: "upload", href: "/finance/upload", label: "올리기" },
      { id: "files", href: "/finance/files", label: "올린 자료" },
      { id: "card", href: "/finance/card", label: "카드 마감" },
    ],
  },
];

/**
 * 🔴 2026 감사 R1(2026-08-26): 탭이 달을 버려 9/1에 8월을 정리하다 탭을 누르면 전 화면이 9월로 튀었다
 *    — 보는 달을 모든 탭에 붙인다 (계산서는 돈 확인 뷰로).
 */
export function FinTabs({ tab, ym }: { tab: FinTabId; ym?: string }) {
  const hrefOf = (t: Tab) => {
    if (!ym || t.external) return t.href;
    /* 최근 한 일은 기본이 「최근 30일」 — 달을 붙이지 않는다(달 고르기는 그 화면 안에서) */
    if (t.id === "activity") return t.href;
    if (t.id === "tax") return `${t.href}?view=money&ym=${ym}`;
    return `${t.href}?ym=${ym}`;
  };
  const group = GROUPS.find((g) => g.tabs.some((t) => t.id === tab)) ?? GROUPS[0];
  return (
    <nav className="-mx-4 mt-2 overflow-x-auto px-4">
      <div className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1 lg:min-w-0">
        {GROUPS.map((g) => (
          <Link
            key={g.id}
            /* 묶음을 누르면 그 묶음의 첫 화면으로 */
            href={hrefOf(g.tabs[0])}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-center text-sm font-semibold lg:flex-1 ${
              g.id === group.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {g.label}
          </Link>
        ))}
      </div>
      <div className="mt-1.5 flex min-w-max gap-1 lg:min-w-0">
        {group.tabs.map((t) => (
          <Link
            key={t.id}
            href={hrefOf(t)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              t.id === tab
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 active:bg-slate-100"
            }`}
          >
            {t.label}
            {t.external && <span className="ml-0.5 text-xs opacity-60">↗</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
