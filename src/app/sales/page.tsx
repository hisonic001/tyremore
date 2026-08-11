import Link from "@/lib/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { marsAudit } from "@/lib/mars-audit";
import { ResolveButton } from "./audit-resolve";
import { latestMarsRun } from "@/lib/mars-run";
import { saleHistory } from "@/lib/sale-history";
import { PeriodFilter } from "./filter";
import { SalesList } from "./mars-upload";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * 정비 내역 (사장님 요청 2026-08-04)
 *
 *   "날짜마다 어떤 정비내역이 있는지 확인 가능해야함."
 *
 * MARS 대기열이 「앞으로 칠 것」이라면 여기는 **지나간 것 전부**다.
 * 날짜별로 묶고, 고객·차량 카드에서 「정비 이력」으로 바로 들어온다.
 */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    range?: string;
    from?: string;
    to?: string;
    customer?: string;
    vehicle?: string;
    canceled?: string;
    pay?: string;
  }>;
}) {
  const sp = await searchParams;
  const customerId = sp.customer ? Number(sp.customer) : undefined;
  const vehicleId = sp.vehicle ? Number(sp.vehicle) : undefined;
  const includeCanceled = sp.canceled === "1";
  /**
   * ⭐ 결제 방법 필터 (사장님 요청 2026-08-07).
   *    지역화폐 추가 (2026-08-10). 「카드」로 거르면 카드가 섞인 분할 결제도 나온다 —
   *    「혼합」은 분할 결제 건만 모아 본다.
   */
  const PAY_OPTIONS = ["현금", "카드", "계좌이체", "지역화폐", "외상", "혼합", "서비스"];
  const pay = sp.pay && PAY_OPTIONS.includes(sp.pay) ? sp.pay : undefined;
  const scoped = Number.isFinite(customerId) || Number.isFinite(vehicleId);

  /**
   * ⭐ 기간 필터 — 기본은 **오늘** (사장님 요청 2026-08-05).
   *    과거 이력 3,100건이 들어와 「전체」 기본은 무겁고 오늘 일이 묻힌다.
   *    단, 고객·차량 이력으로 들어왔을 때는 전체가 기본 — 카드에서 온 사람은
   *    「이 차의 과거」를 보러 온 것이니까.
   */
  // Vercel 서버는 UTC — 한국 아침 9시 전에는 하루 어긋나므로 KST 로 못박는다
  const kst = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const today = kst(new Date());
  const yesterday = kst(new Date(Date.now() - 86400_000));
  const thisMonth = today.slice(0, 7);
  const explicit = sp.range ?? (sp.month ? "month" : sp.from || sp.to ? "range" : null);
  const active = explicit ?? (scoped ? "all" : "today");

  // ⭐ 외상 필터일 때 미수금 총액 (사장님 선택 2026-08-11)
  const receivable =
    pay === "외상"
      ? (
          await db.execute<{ n: number; remain: string }>(sql`
            SELECT count(*) FILTER (WHERE q.total_amount > COALESCE(rp.paid, 0))::int n,
                   COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0)), 0)::bigint remain
            FROM quote q
            LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp
              ON rp.quote_id = q.id
            WHERE q.status = '성사' AND q.payment_method = '외상'
          `)
        )[0]
      : null;

  // ⭐ MARS 실행 진행도 여기서 보인다 — /mars 페이지는 없앴다 (사장님 지시 2026-08-09)
  const run = await latestMarsRun();
  // ⭐ MARS 정합 감사 (2026-08-10 개선 전략) — 어긋난 건이 있을 때만 배너가 뜬다.
  //    🔴 감사가 죽어도 정비 내역은 떠야 한다 (2026-08-11) — 부가 정보일 뿐이다.
  const audit = await marsAudit().catch(() => null);
  const h = await saleHistory({
    month: active === "month" ? sp.month : active === "thisMonth" ? thisMonth : undefined,
    from: active === "today" ? today : active === "yesterday" ? yesterday : active === "range" ? sp.from : undefined,
    to: active === "today" ? today : active === "yesterday" ? yesterday : active === "range" ? sp.to : undefined,
    customerId: Number.isFinite(customerId) ? customerId : undefined,
    vehicleId: Number.isFinite(vehicleId) ? vehicleId : undefined,
    includeCanceled,
    paymentMethod: pay,
  });

  /**
   * 🔴 화면 과부하 방지 (2026-08-07 「계속 로딩중」 사건).
   *    전체 기간은 3,100건이 넘는다 — 서버·DB는 0.2초면 만들어 보내지만(실측),
   *    카드 3천 장을 받은 **폰 브라우저가 그리다 얼어붙는다** (client-side exception).
   *    서버가 아무리 빨라도 화면에 다 쏟으면 소용없다 — 최근 200건까지만 그리고
   *    나머지는 숫자로 알린 뒤 범위를 좁히게 안내한다. 합계·건수는 전체 기준 그대로다.
   */
  const CAP = 200;
  const totalEntries = h.days.reduce((s, d) => s + d.sales.length, 0);
  let shown = 0;
  const days: typeof h.days = [];
  for (const d of h.days) {
    if (shown >= CAP) break;
    const take = d.sales.slice(0, CAP - shown);
    shown += take.length;
    days.push(take.length === d.sales.length ? d : { ...d, sales: take });
  }
  // 서버도 최근 240건까지만 가져온다 (2026-08-11) — 안 보인 수는 전체 건수 기준으로 센다
  const hiddenCount = Math.max(totalEntries, h.saleCount) - shown;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      month: sp.month,
      range: sp.range,
      from: sp.from,
      to: sp.to,
      customer: sp.customer,
      vehicle: sp.vehicle,
      canceled: sp.canceled,
      pay: sp.pay,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6 lg:max-w-6xl">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          ← 검색으로
        </Link>
        <Link href="/sale" className="text-sm font-medium text-emerald-700 underline underline-offset-4">
          판매 등록 →
        </Link>
      </div>

      <h1 className="mt-3 text-2xl font-bold">정비 내역</h1>
      {h.filterLabel ? (
        <p className="mt-1 text-sm text-slate-600">
          <strong>{h.filterLabel}</strong> 의 정비 이력입니다.{" "}
          <Link href="/sales" className="text-slate-500 underline underline-offset-4">
            전체 보기
          </Link>
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">날짜별로 무엇을 정비했는지. 여기서 고치고 취소합니다.</p>
      )}

      {/* ⭐ 기간 필터 — 오늘·이번 달·전체·월·기간 (사장님 요청 2026-08-05) */}
      <PeriodFilter
        months={h.months}
        active={active}
        month={sp.month ?? null}
        from={sp.from ?? null}
        to={sp.to ?? null}
        pay={pay ?? null}
        payOptions={PAY_OPTIONS}
        keep={{
          customer: sp.customer,
          vehicle: sp.vehicle,
          canceled: sp.canceled,
          // 결제 필터를 바꿔도 기간이 풀리지 않게, 기간을 바꿔도 결제가 풀리지 않게
          month: sp.month,
          range: sp.range,
          from: sp.from,
          to: sp.to,
          pay: sp.pay,
        }}
      />

      <p className="tabular mt-3 text-sm text-slate-600">
        {active === "today" && `오늘(${today}) · `}
        {active === "yesterday" && `어제(${yesterday}) · `}
        {active === "thisMonth" && `${thisMonth} · `}
        {pay && `${pay}만 · `}
        {h.saleCount}건 · {won(h.totalAmount)}원
      </p>
      {/* ⭐ 미수금 총액 — 외상 필터일 때 (사장님 선택 2026-08-11). 기간과 무관하게 전체 잔액이다 */}
      {receivable && (
        <p className="tabular mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          못 받은 외상 {Number(receivable.n)}건 · 잔액 {won(Number(receivable.remain))}원 (전체 기간 기준)
        </p>
      )}

      {/*
        ⭐ MARS 정합 감사 배너 (사장님 승인 2026-08-10 — 자동입력 개선 전략).
           자동입력이 실패하면 그 건은 조용히 어긋난 채 남는다 — 그걸 여기서 센다.
           문제가 없으면 아무것도 안 보인다.
      */}
      {audit?.hasIssues && (
        <details className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-amber-900">
            ⚠️ MARS 정리할 것 {audit.unposted.length + audit.unchecked.length}건
            {audit.smoke && !audit.smoke.ok && " · 아침 자가점검 이상"}
            <span className="ml-1 font-normal text-amber-700">(눌러서 자세히)</span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-amber-900">
            {audit.unposted.length > 0 && (
              <div>
                <p className="font-semibold">전기 미확인 {audit.unposted.length}건 — 주문은 MARS 에 채워져 있습니다. MARS 에서 전기해 주세요</p>
                <ul className="tabular mt-1 space-y-0.5 text-amber-800">
                  {audit.unposted.map((r) => (
                    <li key={r.quoteId}>
                      {r.quoteNo} · {r.workDate} · {[r.customerName, r.plateNo].filter(Boolean).join(" ")} ·{" "}
                      {won(r.total)}원
                      {/* 이미 MARS 에서 직접 전기한 건은 이 단추로 배너에서 내린다 */}
                      <ResolveButton quoteId={r.quoteId} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {audit.unchecked.length > 0 && (
              <div>
                <p className="font-semibold">차량 점검 미완 {audit.unchecked.length}건 — 매장 PC 에서 점검 실행(npm run mars -- --check)으로 한 번에 처리됩니다</p>
                <ul className="tabular mt-1 space-y-0.5 text-amber-800">
                  {audit.unchecked.map((r) => (
                    <li key={r.quoteId}>
                      {r.quoteNo} · {r.workDate} · {[r.customerName, r.plateNo].filter(Boolean).join(" ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {audit.smoke && !audit.smoke.ok && (
              <p>
                <span className="font-semibold">아침 자가점검({audit.smoke.at}) 이상</span> — {audit.smoke.note}.
                MARS 화면이 바뀌었을 수 있습니다. 오늘 자동 올리기 결과를 지켜봐 주세요.
              </p>
            )}
            <p className="text-xs text-amber-700">
              최근 입력 실행 {audit.recentRuns.total}회 중 경고 {audit.recentRuns.warned}회
              {audit.smoke?.ok && ` · 자가점검 ${audit.smoke.at} 통과`}
            </p>
          </div>
        </details>
      )}

      {/* ⭐ MARS 올리기 판 + 날짜별 목록 — 카드 체크·올리기·진행 로그가 한 화면 (2026-08-09) */}
      <SalesList days={days} run={run} hiddenCount={hiddenCount} shown={shown} />

      <div className="mt-6 text-center">
        <Link
          href={`/sales${qs({ canceled: includeCanceled ? undefined : "1" })}`}
          className="text-xs text-slate-400 underline underline-offset-4"
        >
          {includeCanceled ? "취소된 것 감추기" : "취소된 것도 보기"}
        </Link>
      </div>
    </main>
  );
}
