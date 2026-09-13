import { redirect } from "next/navigation";
import Link from "@/lib/link";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm } from "@/lib/ym";
import { FinShell } from "@/components/fin/shell";
import { weeklyDepositStep } from "@/lib/weekly-deposits";
import { W } from "@/lib/fin-words";
import { DepositsFlow } from "@/app/finance/weekly/steps/deposits-flow";

export const dynamic = "force-dynamic";

// 감사 L3: 달 계산은 lib/ym 정본

/**
 * ⭐ 통장 입금 대조 (ERP 4단계, 2026-08-24) — 사장님 전용
 *
 *   통장에 들어온 돈이 무엇인지 정리한다: 카드 정산 / 계좌이체 판매 / 미수금 수금.
 *   수금은 여기서 바로 등록된다 (선입선출 — 미수금 장부의 정산 로직 그대로).
 *   🔴 개편 5단계(2026-09-13): 몸통은 「이번 주 정리」 ③ 과 같은 3층(DepositsFlow) — 옛 DepositsRecon 은
 *      지웠다. 여기서는 머리 문구·요약 한 줄·빈 상태·되돌리기·다음 링크만 그린다(조회는 어댑터 한 번).
 */
export default async function FinanceDepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  /* ⭐ 3단계(2026-09-12): 조립(depositReconData → depositTaxCandidates → depositSurePicks → arrangeDeposits
     + transferSalesMissing)은 weekly-deposits.ts 로 옮겼다 — 「이번 주 정리」 흐름과 이 화면이 같은 것을 쓴다. */
  const step = await weeklyDepositStep(ym);
  const { data, breakdown } = step;
  /* 🔴 2단계(2026-09-12): 「통장 밖」으로 정리한 판매의 되돌리기 목록은 「최근 한 일」(/finance/activity)로
     옮겼다 — 이 화면엔 링크 한 줄만 (결정 f). 5단계(09-13)에 추적 화면의 옛 목록도 없애고,
     기록이 없던 옛 자국 35건은 scripts/add-aside-activity.ts 로 「최근 한 일」에 옮겨 적었다. */
  const month = Number(ym.slice(5, 7));

  return (
    <FinShell tab="deposits" monthNav={{ ym, basePath: "/finance/deposits" }}>
      <p className="mt-2 text-sm text-slate-500">
        통장에 들어온 돈이 무엇인지 {W.recon}합니다 — 카드 정산 · 세금계산서 대금 · 판매 · {W.receivable} 수금 · 판매와 무관(이자·지원금·환불).
        짝이 확실한 것은 한 번에, 나머지는 카드마다 고르면 됩니다.
      </p>

      {/* 요약 한 줄 — 어댑터가 이미 가진 숫자만(조회 없음) */}
      <p className="tabular mt-4 text-sm">
        정리할 입금 <strong>{data.openTotal}건</strong>
        {data.openTotal > 0 && (
          <span className="text-xs text-slate-500">
            {" "}(계산서 짝 {breakdown.tax} · 판매 짝 {breakdown.quote} · {W.receivable} {breakdown.party} · {W.open} {breakdown.none})
          </span>
        )}
        {data.openTotal > data.open.length && ` · 최근 ${data.open.length}건 표시`} · {W.done} {data.doneCount}건 · {W.ignore}{" "}
        {data.ignoredCount}건
      </p>

      {/* 🔴 2026 감사 R5: 「자료 없음」과 「다 됐다」를 가른다 */}
      {data.open.length === 0 && data.cardPatternCount === 0 && (
        <section className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {data.monthInCount === 0 ? (
            <>
              {month}월 통장 내역이 아직 안 올라왔습니다 —{" "}
              <Link href={`/finance/upload?ym=${ym}`} className="underline">내역 올리기</Link>
            </>
          ) : (
            <>
              {month}월 입금은 다 정리됐습니다 🎉 — 다음은{" "}
              <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold underline">지출 분류 →</Link>
            </>
          )}
        </section>
      )}

      {/* 3층 몸통 — 흐름 ③ 과 같은 조각. standalone: 정비 내역 링크가 흐름이 아니라 여기로 돌아온다 */}
      <DepositsFlow step={step} standalone />

      {/* ⭐ 개편 2단계(2026-09-12) — 이 달에 한 일(통장 밖 정리·분류·카드정산 표시·판매·수금 대조)의
          되돌리기는 「최근 한 일」 한 곳으로 모았다(결정 f). */}
      <p className="mt-4 text-xs text-slate-400">
        잘못 {W.recon}한 입금·분류·카드정산 표시는{" "}
        <Link href="/finance/activity" className="underline underline-offset-2">{W.activityUndoHere}</Link>
        {" "}— 되돌리면 수금 기록까지 함께 풀립니다.
      </p>
      <p className="mt-2 text-sm">
        {W.next}:{" "}
        <Link href={`/finance/expenses?ym=${ym}`} className="font-semibold text-brand-700 underline underline-offset-2">
          지출 분류 →
        </Link>
      </p>
    </FinShell>
  );
}
