import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { ChipLink } from "@/components/ui/chip";
import { won } from "@/components/fin/money";
import { W } from "@/lib/fin-words";
import { kstToday, pickYm } from "@/lib/ym";
import { closedDelta, recentActivity } from "@/lib/fin-activity";
import { ActivityList } from "./activity-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 최근 한 일 — 되돌리기 한 곳 (돈관리 개편 2단계, 2026-09-12)
 *
 *   사장님 결정 14: 「최근 한 일」 한 곳에 시간순 목록, 각 화면의 접힌 되돌리기 표는 없앰.
 *   2단계 답: 돈관리에서 한 것 전부 + 앱이 자동으로 한 것(따로 묶어서), 최근 30일 + 달 고르기.
 *   결정 15: 마감 뒤 고치면 여기 남고(「마감 뒤」 표시) 마감 때 숫자와의 차이를 띠로.
 *
 *   ?ym= 없으면 최근 30일, 있으면 그 달. ?who= 사람|자동 칩. 정본은 lib/fin-activity 하나(recentActivity·closedDelta).
 * 🔴 질의 순차. 되돌리기는 fin-activity-actions.undoActivity → 기존 undo 함수(새 논리 없음).
 */
export default async function FinanceActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/");

  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && sp.ym ? pickYm(sp.ym) : null;
  const who = sp.who === "사람" || sp.who === "자동" ? sp.who : null;
  const thisYm = kstToday().slice(0, 7);

  const days = await recentActivity({ ym, who });
  const delta = ym ? await closedDelta(ym) : null;
  const total = days.reduce((s, d) => s + d.rows.length, 0);

  const href = (q: { ym?: string | null; who?: string | null }) => {
    const p = new URLSearchParams();
    const y = q.ym === undefined ? ym : q.ym;
    const w = q.who === undefined ? who : q.who;
    if (y) p.set("ym", y);
    if (w) p.set("who", w);
    const qs = p.toString();
    return `/finance/activity${qs ? `?${qs}` : ""}`;
  };

  return (
    <FinShell
      tab="activity"
      ym={ym ?? undefined}
      monthNav={ym ? { ym, basePath: "/finance/activity", keep: who ? { who } : undefined } : undefined}
      closeNotice={false}
    >
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {ym ? (
            <>
              {Number(ym.slice(5, 7))}월에 한 일 {total}건 ·{" "}
              <Link href={href({ ym: null })} className="underline underline-offset-2">
                최근 30일로
              </Link>
            </>
          ) : (
            <>
              최근 30일 {total}건 ·{" "}
              <Link href={href({ ym: thisYm })} className="underline underline-offset-2">
                달 고르기
              </Link>
            </>
          )}
        </p>
        <div className="flex gap-1.5">
          <ChipLink href={href({ who: null })} active={!who}>
            전부
          </ChipLink>
          <ChipLink href={href({ who: "사람" })} active={who === "사람"}>
            내가
          </ChipLink>
          <ChipLink href={href({ who: "자동" })} active={who === "자동"}>
            앱이
          </ChipLink>
        </div>
      </div>

      {/* 마감 뒤 고침 띠 — 장부(ledger) 의 주의 상자 문법 그대로 */}
      {delta && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          ⚠️ {Number(delta.ym.slice(5, 7))}월 마감 뒤 고친 것 {delta.n}건 · {W.profit} {won(delta.closedProfit)} → {won(delta.nowProfit)}원
          <Link href={`/finance/ledger?ym=${delta.ym}#close`} className="ml-2 underline underline-offset-2">
            장부 →
          </Link>
        </div>
      )}

      <ActivityList days={days} />

      <p className="mt-3 text-xs text-slate-400">
        {W.undo}는 여기서만 합니다. 되돌린 줄은 지우지 않고 회색 「{W.undone}」으로 남깁니다. 앱이 자동으로 한 일은 「앱」.
      </p>
    </FinShell>
  );
}
