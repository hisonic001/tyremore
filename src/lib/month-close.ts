"use server";

/**
 * ⭐ 월 마감 (ERP 구조화 배치4, 사장님 승인 2026-08-25)
 *
 *   달이 끝나고 정리(입금·지출·계산서·자료 검증)가 다 되면 「마감」을 눌러
 *   그 달 숫자를 확정 표시한다. 하드 락은 없다 — 마감된 달을 고치면 배너로
 *   알리고, [마감 풀기]로 언제든 되돌린다 (되돌리기 가능 원칙).
 *
 * 🔴 질의 순차 · LIMIT. 마감 숫자(headline)는 현황 손익과 같은 식으로 계산해
 *    jsonb 로 남긴다 — 수수료는 정산 자료의 실측만 넣는다(추정치 제외).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "./auth";
import { finHealth } from "./fin-health";
import { kstToday, monthRange } from "./ym";
import { depositOpenCount, expenseOpen, payablesData } from "./recon-data";
import { taxOpenCount } from "./tax-recon";
import { finPL } from "./fin-pl";
import { revalidateFinance } from "./fin-revalidate";
import { uploadCoverage, coverageStatus } from "./upload-coverage";
import { cardDaySums } from "./card-recon";
import { posDaysSummary } from "./pos-close";
import { zeroTotalInvoiceCount } from "./invoice";
import { logActivity } from "./fin-activity";
import { W } from "./fin-words";

export interface CloseCheck {
  /** 항목 이름 — 화면이 순서가 아니라 이름으로 고른다 (2026-09-11 첫 화면 개편) */
  key: "upload" | "card" | "deposits" | "expenses" | "tax" | "posclose" | "payables" | "zero" | "health";
  ok: boolean;
  text: string;
  href: string;
  /** 참고 항목 — ⚠ 로 보여 주되 마감을 막지 않는다 (자료 컷오프·카드 차이·미지급·0원 매입) */
  soft?: boolean;
}

export interface MonthCloseInfo {
  closed: boolean;
  closedAt: string | null;
  profit: number | null;
  /** 앱 판매·매입 기록이 있는 달인가 — 없으면(2025) 손익은 의미가 없어 「자료 기준 마감」으로 표시 */
  dataComplete: boolean;
}

export async function monthCloseStatus(ym: string): Promise<MonthCloseInfo> {
  const r = await db.execute<{ d: string; headline: unknown }>(sql`
    SELECT to_char(closed_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') d, headline
    FROM month_close WHERE ym = ${ym} LIMIT 1
  `);
  if (!r[0]) return { closed: false, closedAt: null, profit: null, dataComplete: true };
  const h = r[0].headline as { profit?: number; dataComplete?: boolean } | null;
  return {
    closed: true,
    closedAt: r[0].d,
    profit: typeof h?.profit === "number" ? h.profit : null,
    dataComplete: h?.dataComplete !== false,
  };
}

/** 마감 조건 체크리스트 — 미충족 항목은 그 화면으로 가는 링크가 된다 */
export async function closeChecklist(ym: string, healthOk?: boolean): Promise<CloseCheck[]> {
  /* 🔴 2026 감사 N1·N2·N3: 세 항목 전부 각 화면·현황 카드와 **같은 함수**로 센다 — 전엔 입금은
     '미대조'만(입금 화면은 미대조+제안·잔액>0), 계산서는 recon_status(돈 확인 뷰는 bank_ok)라
     같은 달에 타일 "다 맞춰짐 ✓"와 마감 줄 "확인 안 됨 5건"이 동시에 떴다 */
  const depN = await depositOpenCount(ym);
  const exp = await expenseOpen(ym);
  /* 🔴 2025 감사 F6(2026-08-26): 「대조 도입 전 달이라 건너뜀」 분기 삭제 — 모든 달이 같은 기준 */
  const taxN = await taxOpenCount(ym);
  const dep = { n: depN };
  const taxCheck: CloseCheck = {
    key: "tax",
    ok: taxN === 0,
    text: taxN === 0 ? "세금계산서 돈 확인 다 됨" : `세금계산서 돈 확인 안 됨 ${taxN}건`,
    href: `/finance/tax?view=money&ym=${ym}`,
  };
  const hOk = healthOk ?? (await finHealth()).allOk;
  /* 🔴 2025 감사 F6: 자료 검증은 「최근 60일·최근 3달」 기준이라 지난 달(특히 2025) 마감과
     무관하다 — 지난 달은 경고만 보이고 마감을 막지 않는다 */
  const past = ym < kstToday().slice(0, 7);
  /* 🔴 2026 감사 R2·R3: 사장님 루틴 8단계 중 체크리스트가 3단계만 봤다 — 자료 올림·카드 매출·미지급·
     0원 매입을 참고(soft) 항목으로 추가. 막지는 않고 ⚠ 만 */
  const cov = coverageStatus(await uploadCoverage(), ym);
  const card = await cardDaySums(ym);
  const pay = await payablesData();
  const zeroN = await zeroTotalInvoiceCount();
  const softChecks: CloseCheck[] = [
    {
      key: "upload",
      ok: cov.ok,
      soft: true,
      text: cov.ok ? "자료 다 올라옴" : `안 올라온 자료 — ${cov.lagging.map((l) => `${l.label} ~${l.last ? l.last.slice(5) : "없음"}`).join(" · ")}`,
      href: `/finance/upload?ym=${ym}`,
    },
    {
      key: "card",
      ok: !!card.assocLast && card.diffDays === 0,
      soft: true,
      text: !card.assocLast
        ? "여신협회 카드 자료 없음"
        : card.diffDays === 0
          ? "카드 매출 다 맞음"
          : `카드 매출 차이 난 날 ${card.diffDays}일`,
      href: `/finance/card?ym=${ym}`,
    },
  ];
  const posDays = await posDaysSummary(ym);
  const posOpen = posDays.filter((d) => !d.closed);
  const softTail: CloseCheck[] = [
    ...(posDays.length > 0
      ? [
          {
            key: "posclose" as const,
            ok: posOpen.length === 0,
            soft: true,
            text: posOpen.length === 0 ? `카드 일마감 ${posDays.length}일 다 됨` : `카드 일마감 안 된 날 ${posOpen.length}일`,
            href: `/finance/card?ym=${ym}&d=${posOpen[0]?.day ?? ym + "-01"}`,
          },
        ]
      : []),
    {
      key: "payables" as const,
      ok: pay.suppliers.length === 0,
      soft: true,
      text: pay.suppliers.length === 0 ? "미지급 없음" : `줄 돈 확인 — 미지급 ${pay.suppliers.length}곳 ${pay.totalRemain.toLocaleString("ko-KR")}원`,
      href: `/finance/payables?ym=${ym}`,
    },
    ...(zeroN > 0
      ? [{ key: "zero" as const, ok: false, soft: true, text: `금액 없는 매입 장부 ${zeroN}건 — 단가를 채워 주세요`, href: "/receiving" }]
      : []),
  ];

  return [
    ...softChecks,
    {
      key: "deposits",
      ok: Number(dep.n) === 0,
      text: Number(dep.n) === 0 ? "입금 다 정리됨" : `정리 안 된 입금 ${dep.n}건`,
      href: `/finance/deposits?ym=${ym}`,
    },
    {
      key: "expenses",
      ok: Number(exp.n) === 0,
      text: Number(exp.n) === 0 ? "지출 다 분류됨" : `분류 안 된 지출 ${exp.n}건`,
      href: `/finance/expenses?ym=${ym}`,
    },
    taxCheck,
    ...softTail,
    {
      key: "health",
      ok: hOk || past,
      text: hOk ? "자료 검증 ✓" : past ? "자료 검증 경고 있음 (최근 자료 기준 — 지난 달 마감은 막지 않음)" : "자료 검증 경고 있음",
      href: `/finance?ym=${ym}`,
    },
  ];
}

/** 마감 당시 손익 머리숫자 — 🔴 2026 감사 N5: 현황과 **같은 함수**(fin-pl.finPL). 추정 수수료 여부도 함께 남긴다 */
async function computeHeadline(ym: string) {
  const pl = await finPL(ym);
  return {
    earned: pl.earnedTotal,
    bought: pl.bought,
    cardOut: pl.cardOut,
    fee: pl.feeShown,
    feeEstimated: pl.feeEstimated > 0,
    bankExp: pl.bankExp,
    profit: pl.profit,
    dataComplete: pl.dataComplete,
  };
}

export async function closeMonth(ym: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !(await (await import("./auth")).hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { ok: false, error: "달이 이상합니다" };
  if (ym >= kstToday().slice(0, 7)) return { ok: false, error: "이 달이 끝난 뒤에 마감할 수 있습니다" };

  const checks = await closeChecklist(ym);
  const bad = checks.filter((c) => !c.ok && !c.soft); // 참고 항목은 마감을 막지 않는다
  if (bad.length > 0) return { ok: false, error: `아직 남은 일이 있습니다 — ${bad.map((c) => c.text).join(" · ")}` };

  const headline = await computeHeadline(ym);
  /* ⭐ 최근 한 일 — 🔴 INSERT **앞**에 남긴다: 뒤에 남기면 그 달이 이미 마감이라 after_close=true 로 찍혀
     첫 화면 「마감 뒤 고친 것」에 마감 줄 자신이 세어진다(closedDelta). 이미 마감된 달이면(ON CONFLICT) 안 남긴다 */
  const already = await monthCloseStatus(ym);
  if (!already.closed) {
    await logActivity({
      ym,
      actor: session.uid,
      how: "사람",
      verb: "마감",
      amount: headline.profit,
      label: `월 마감 ${ym} · ${W.profit} ${headline.profit.toLocaleString("ko-KR")}${headline.dataComplete ? "" : " (자료 기준 마감)"}`,
      undo: { kind: "monthClose", args: { ym } },
    });
  }
  await db.execute(sql`
    INSERT INTO month_close (ym, closed_by, headline)
    VALUES (${ym}, ${session.uid}, ${JSON.stringify(headline)}::jsonb)
    ON CONFLICT (ym) DO NOTHING
  `);
  revalidateFinance();
  return { ok: true };
}

export async function reopenMonth(ym: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session || !(await (await import("./auth")).hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const gone = await db.execute<{ ym: string }>(sql`DELETE FROM month_close WHERE ym = ${ym} RETURNING ym`);
  if (gone.length > 0) {
    await logActivity({
      ym,
      actor: session.uid,
      how: "사람",
      verb: "되돌리기",
      label: `${W.undo}: 월 마감 풀기 ${ym}`,
    });
  }
  revalidateFinance();
  return { ok: true };
}

/** 폼 액션용 얇은 래퍼 — form action 은 반환값이 없어야 한다 (cancelBatch 전례) */
export async function closeMonthForm(ym: string, _fd: FormData): Promise<void> {
  await closeMonth(ym);
}
export async function reopenMonthForm(ym: string, _fd: FormData): Promise<void> {
  await reopenMonth(ym);
}
