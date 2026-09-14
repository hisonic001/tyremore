import Link from "@/lib/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, logout, hasPerm } from "@/lib/auth";
import { marsReportTechAllowed } from "@/lib/mars-eval";
import { W } from "@/lib/fin-words";
import { ChangePassword } from "./password";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Boxes,
  Car,
  ChevronRight,
  ClipboardList,
  Megaphone,
  Sparkles,
  Store,
  Tags,
  Truck,
  Users,
  Wrench,
  Wallet,
} from "lucide-react";

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
/* ⭐ 배치4 — 메뉴 아이콘 (토스 리스트 문법: 원형 아이콘 + 제목/설명 + 화살표) */
const ICONS: Record<string, ReactNode> = {
  "/reports": <BarChart3 className="size-5" />,
  "/settings/users": <Users className="size-5" />,
  "/finance": <Wallet className="size-5" />,
  /* ⭐ 「자동 규칙」 — 앱이 배운 것 (개편 4단계, 2026-09-12) */
  "/settings/rules": <Sparkles className="size-5" />,
  "/reports/mars": <ClipboardList className="size-5" />,
  "/settings/products": <Tags className="size-5" />,
  "/stock": <Boxes className="size-5" />,
  "/settings/suppliers": <Truck className="size-5" />,
  "/settings/services": <Wrench className="size-5" />,
  "/carinfo": <Car className="size-5" />,
  "/settings/spec": <BookMarked className="size-5" />,
  "/receivables": <BookOpen className="size-5" />,
  "/settings/shop": <Store className="size-5" />,
  "/status": <Activity className="size-5" />,
  "/marketing": <Megaphone className="size-5" />,
};

export default async function SettingsPage() {
  const session = await getSession();

  /**
   * ⭐ 마지막 백업 확인 (2026-08-05 자동 백업).
   *    백업은 매장 PC 작업 스케줄러가 매일 13:30 에 돌고, 성공하면 backup_log 에
   *    기록을 남긴다. 이틀 넘게 기록이 없으면 여기서 경고한다 —
   *    PC 가 꺼져 있었거나 스케줄러가 죽은 것이다.
   */
  const [bk] = await db.execute<{ ago_h: number; at_s: string }>(sql`
    SELECT EXTRACT(EPOCH FROM (now() - at)) / 3600 AS ago_h,
           to_char(at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS at_s
    FROM backup_log ORDER BY id DESC LIMIT 1
  `);
  const backupStale = !bk || Number(bk.ago_h) > 48;

  /* ⭐ 정비사도 MARS 평가 리포트를 볼 수 있게 켜 놨으면 여기로 들어간다 (2026-08-10) */
  const techMarsLink = session?.role === "tech" && (await marsReportTechAllowed());
  /* ⭐ 제원 검수 대기 수 (2026-09-05) — 승인 전엔 앱 어디에도 숫자가 안 열린다는 걸 보이게 */
  const [sw] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM vehicle_spec WHERE status = '검수대기'`);
  const specWaiting = Number(sw?.n ?? 0);
  /* ⭐ 권한 스위치 (2026-09-02) — 메뉴는 그 계정이 열 수 있는 것만 보인다 */
  const can = {
    finance: await hasPerm("finance"),
    reports: await hasPerm("reports"),
    stock: await hasPerm("stock"),
    receivable: await hasPerm("receivable_view"),
    master: await hasPerm("master"),
    marketing: await hasPerm("marketing"),
  };

  const items = [
    ...(can.reports
      ? [{ href: "/reports", title: "리포트", desc: "매출 · 재고 · 마진 · MARS 입력 평가 · 손님 · 차량" }]
      : []),
    /* ⭐ 계정 관리 — 유일하게 항상 사장님 전용 (직원이 스스로 권한을 켜는 구멍 방지, 2026-09-02) */
    ...(session?.role === "owner"
      ? [
          {
            href: "/settings/users",
            title: "계정 관리",
            desc: "계정 만들기 · 할 수 있는 일 스위치 · 아이디·비밀번호 (항상 사장님 전용)",
          },
        ]
      : []),
    /* ⭐ 마케팅 (2026-09-02) — 권한 스위치로 옮겼다. 홈에도 진입 줄이 있다 */
    ...(can.marketing
      ? [
          {
            href: "/marketing",
            title: "마케팅",
            desc: "네이버 블로그 원고 · 리뷰 답글 초안 — 발행은 직접 하십니다",
          },
        ]
      : []),
    ...(can.finance
      ? [{ href: "/finance", title: "돈 관리", desc: "통장·법인카드 내역 올리기 · 월 자금 흐름" }]
      : []),
    /*
     * ⭐ 「자동 규칙」 (개편 4단계, 2026-09-12) — 사장님 결정 5 「보고 끄기만」.
     *    맞추기 단추 옆 「다음부터 자동으로」를 켠 채로 한 번 맞추면 앱이 스스로 배운다.
     *    배운 것이 틀렸을 때 여기서 끈다 — 돈 관리 바로 뒤에 둔 건 전부 돈 관리에서 배운 것이라서.
     */
    ...(can.finance
      ? [
          {
            href: "/settings/rules",
            title: W.rules,
            desc: "앱이 배운 이름 짝·계산서 상대·지출 분류·입금 성격 — 보고 끄기",
          },
        ]
      : []),
    ...(techMarsLink
      ? [
          {
            href: "/reports/mars",
            title: "MARS 입력 평가",
            desc: "본사 평가표 기준 — 이번 분기 MARS 등록 수량·점수",
          },
        ]
      : []),
    ...(can.master
      ? [{ href: "/settings/products", title: "상품", desc: "거래처 목록으로 채우기 · 새 상품 등록 · 안 받는 것 숨기기" }]
      : []),
    /* ⭐ 공임·정비 목록 (사장님 요청 2026-08-31) — 판매의 「공임·정비 추가」 검색이 쓰는 목록 */
    ...(can.master
      ? [{ href: "/settings/services", title: "공임·정비", desc: "판매에서 고르는 공임 목록 — 이름·금액 고치기 · 새로 만들기 · 숨기기" }]
      : []),
    /*
     * ⭐ 재고는 홈 메뉴에서 여기로 내려왔다 (사장님 지시 2026-08-06) —
     *    홈 자리는 정비 내역이 가져갔다. 재고 수량은 어차피 검색 카드에 보인다.
     */
    ...(can.stock ? [{ href: "/stock", title: "재고", desc: "창고에서 세는 화면 · 재고 목록 · DOT·수량 맞추기" }] : []),
    ...(can.master ? [{ href: "/settings/suppliers", title: "거래처", desc: "추가 · 이름 고치기 · 합치기 · 숨기기" }] : []),
    /*
     * ⭐ 차종별 순정 제원 (사장님 요청 2026-09-03) — 「내가 한번더 검수하겠음」
     *    제조사 취급설명서에서 옮겨 온 값을 원문과 나란히 놓고 확인하는 화면.
     *    확인 전에는 휠너트 토크 같은 위험 값의 숫자가 앱 어디에도 안 나온다.
     */
    /* ⭐ 정비 조회 (2026-09-05, /carinfo 도입 3단계) — 등록 안 된 차·전화 문의 대응.
       조회 화면은 로그인만 보므로 메뉴도 모두에게 보인다 */
    {
      href: "/carinfo",
      title: "정비 조회",
      desc: "차대번호·사진으로 차종 제원 조회 — 등록 안 된 차도",
    },
    ...(can.master
      ? [
          {
            href: "/settings/spec",
            title: "차종별 순정 제원",
            desc:
              specWaiting > 0
                ? `검수 대기 ${specWaiting}개 — 확인해야 앱에 숫자가 열립니다`
                : "공기압 · 휠너트 토크 · 오일 규격 — 설명서 원문과 나란히 확인",
          },
        ]
      : []),
    // ⭐ 외상 장부 (2026-08-17) — 정비 내역 위쪽에도 길이 있지만 설정에서도 찾을 수 있게
    ...(can.receivable
      ? [{ href: "/receivables", title: "외상 장부", desc: "거래처·손님별로 못 받은 돈 · 한꺼번에 털기" }]
      : []),
    {
      href: "/settings/shop",
      title: "가게 정보",
      desc: "견적서·거래명세서에 찍히는 상호·사업자번호·도장",
    },
    { href: "/status", title: "이관 현황", desc: "들어온 데이터와 보정 대기 목록" },
  ];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5 lg:max-w-3xl">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>
      <h1 className="mt-3 text-xl font-bold">설정</h1>
      <p className="mt-1 text-sm text-slate-500">
        판매 · 매입 · 정비 내역은 <strong>홈 맨 위 메뉴</strong>에 있습니다.
      </p>

      {backupStale ? (
        <p className="mt-3 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⚠️ <strong>백업이 이틀 넘게 없습니다</strong>
          {bk && ` (마지막: ${bk.at_s})`}. 매장 PC 가 꺼져 있었는지 확인해 주세요 — PC 를 켜면
          자동으로 보충 실행됩니다.
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-400">
          ✅ 마지막 자동 백업: {bk!.at_s} (매일 13:30, 매장 PC · 최근 14개 보관)
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className="flex items-center gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-card transition-colors active:bg-slate-50 lg:hover:bg-slate-50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                {ICONS[i.href] ?? <ChevronRight className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{i.title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-slate-500">{i.desc}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-slate-300" />
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
          {/* ⭐ 내 비밀번호 바꾸기 (사장님 요청 2026-08-08) */}
          <ChangePassword />
          <form action={logout} className="mt-2">
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
