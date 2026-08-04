import Link from "next/link";
import { getSession, logout } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 설정 — 자주 안 쓰는 메뉴를 모아 둔다 (사장님 요청 2026-08-01)
 *
 * ⭐ 2026-08-04 정리 — "지금 기능이 전반적으로 산만해보이는데"
 *
 *   ① **중복을 없앴다.** 매입 입고·매입 내역·재고는 상단 메뉴에 이미 있다.
 *      같은 곳으로 가는 길이 둘이면 어느 쪽이 진짜인지 매번 생각하게 된다.
 *      (매입 내역은 매입 화면 안에서 간다)
 *
 *   ② **묶었다.** 상품에 관한 일이 「상품 정리」·「새 상품 등록」·「금호 상품목록」
 *      세 곳에 흩어져 있었다. 처음엔 메뉴만 세 묶음으로 접었는데 그건 반쪽이었다 —
 *      **화면 수까지 줄여야** 산만함이 실제로 없어진다. 지금은 `/settings/products`
 *      한 화면 안의 탭 세 개다.
 *
 *   ③ 🔴 **브랜드 이름을 메뉴에서 뺐다.** 「금호 상품목록」을 메뉴에 박아 두면
 *      콘티넨탈·미쉐린이 늘 때마다 메뉴가 늘어난다 — 늘어날수록 무너지는 구조다.
 *      거래처는 화면 안에서 고른다.
 *
 * 결과: 설정 하위 8개 → **3개**.
 */
export default async function SettingsPage() {
  const session = await getSession();

  const items = [
    {
      href: "/settings/products",
      title: "상품",
      desc: "거래처 목록으로 채우기 · 새 상품 등록 · 안 받는 것 숨기기",
    },
    { href: "/settings/suppliers", title: "거래처", desc: "추가 · 이름 고치기 · 합치기 · 숨기기" },
    { href: "/status", title: "이관 현황", desc: "들어온 데이터와 보정 대기 목록" },
  ];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">설정</h1>
      <p className="mt-1 text-sm text-slate-500">
        판매 · 매입 · 재고는 <strong>맨 위 메뉴</strong>에 있습니다.
      </p>

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
