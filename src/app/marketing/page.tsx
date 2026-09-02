import { ChevronRight, MessageSquareReply, PenLine } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "@/lib/link";
import { isOwner } from "@/lib/auth";
import { pendingDraftCount } from "@/lib/blog-draft";
import { StatusPill } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/ui/page";

export const dynamic = "force-dynamic";

/**
 * 마케팅 홈 (2026-08-29, docs/17-네이버-마케팅.md)
 *
 * 네이버 블로그·플레이스는 프로그램이 대신 올리면 매크로 판정이라 **초안까지만** 만든다.
 * 발행·답글 등록은 사장님이 복사해서 직접 한다 — MARS 자동입력의 「전기는 안 한다」와 같은 원칙.
 * 검색광고 API 는 월 광고비가 50만원을 넘으면 붙인다 (지금 25만원 — 수집 자동화보다 계정 점검이 낫다).
 */
export default async function MarketingHome() {
  if (!(await isOwner())) redirect("/settings");
  const pending = await pendingDraftCount();

  const items = [
    {
      href: "/marketing/blog",
      Icon: PenLine,
      title: "블로그 초안",
      desc: "매장 PC 가 그날 시공으로 원고를 만듭니다. 한마디 쓰고 복사해서 올리세요.",
      badge: pending > 0 ? `${pending}개 대기` : null,
    },
    {
      href: "/marketing/reply",
      Icon: MessageSquareReply,
      title: "리뷰 답글 초안",
      desc: "플레이스 리뷰를 붙여넣으면 답글을 써 줍니다. 등록은 플레이스 앱에서.",
      badge: null,
    },
  ];

  return (
    <PageShell>
      <PageHeader title="마케팅" back={{ href: "/settings", label: "설정" }} />
      <ul className="mt-2 divide-y divide-slate-100 rounded-card border border-slate-200 bg-white">
        {items.map(({ href, Icon, title, desc, badge }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-4 active:bg-slate-50 lg:hover:bg-slate-50">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{title}</span>
                  {badge && <StatusPill tone="accent">{badge}</StatusPill>}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{desc}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>

      {/* 0단계 — 개발 없이 먼저 손으로. 자동화 전체보다 효과가 크다 (SEO 전문가·광고 마케터 리뷰) */}
      <section className="mt-6 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-bold">먼저 손으로 하실 것 (반나절, 효과는 제일 큼)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-snug">
          <li>
            <strong>플레이스</strong> — 대표키워드·업종·영업시간·임시휴무 정확히, 예약/톡톡 켜기.
            소식은 <strong>주 1회</strong> 사진 1장 + 한 줄. 시공 끝나면 <strong>리뷰 요청 QR</strong> —
            2026-07부터 평균 별점이 공개라 답글보다 별점 관리가 먼저입니다.
          </li>
          <li>
            <strong>검색광고</strong> — 계정 1시간 열어 <strong>제외 키워드·지역·시간대</strong>만 손보기.
            이 규모에서 돈을 아끼는 건 입찰가가 아니라 이 셋입니다. 비용 상위 5개 키워드 확인.
          </li>
          <li>
            <strong>판매 등록</strong> — 결제 칸의 「어떻게 알고 오셨어요?」를 눌러 주세요.
            광고가 돈이 됐는지 볼 수 있는 유일한 숫자입니다.
          </li>
        </ul>
      </section>
    </PageShell>
  );
}
