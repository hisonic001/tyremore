import Link from "next/link";
import { getSession, logout } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 설정 — 자주 안 쓰는 메뉴를 모아 둔다 (사장님 요청 2026-08-01)
 * 메인 화면 상단이 좁아 제목이 밀리던 문제도 함께 해결한다.
 */
export default async function SettingsPage() {
  const session = await getSession();

  const items = [
    { href: "/settings/suppliers", title: "거래처", desc: "추가 · 이름 고치기 · 합치기 · 숨기기" },
    { href: "/settings/catalog", title: "상품 정리", desc: "안 받는 브랜드·단종 상품 숨기기" },
    { href: "/receiving", title: "매입 입고", desc: "인보이스 올리기 · 바코드 입고 · 직접 매입" },
    { href: "/receiving/history", title: "매입 내역", desc: "날짜별로 언제 어디서 얼마에 샀는지" },
    { href: "/stock", title: "재고", desc: "엑셀로 내려받고 고쳐서 올리기" },
    { href: "/product/new", title: "새 상품 등록", desc: "MARS 에 없는 신모델" },
    { href: "/settings/kumho", title: "금호 상품목록", desc: "자재검색 엑셀 올리기 · 품번 잇기 · 기표가 맞추기" },
    { href: "/status", title: "이관 현황", desc: "들어온 데이터와 보정 대기 목록" },
  ];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">설정</h1>

      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className="block rounded-xl border border-slate-200 bg-white p-4 active:bg-slate-50"
            >
              <div className="font-semibold">{i.title}</div>
              <div className="mt-0.5 text-sm text-slate-500">{i.desc}</div>
            </Link>
          </li>
        ))}
      </ul>

      {session && (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">로그인</div>
          <div className="mt-0.5 font-semibold">
            {session.name}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {session.role === "owner" ? "사장님 (매입가·마진 보임)" : "정비사"}
            </span>
          </div>
          <form action={logout} className="mt-3">
            <button
              type="submit"
              className="w-full rounded-lg border border-slate-300 py-3 font-medium text-slate-600"
            >
              로그아웃
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
