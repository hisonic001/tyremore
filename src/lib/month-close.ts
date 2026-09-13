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
import { finPL } from "./fin-pl";
import { revalidateFinance } from "./fin-revalidate";
import { zeroTotalInvoiceCount } from "./invoice";
import { logActivity } from "./fin-activity";
import { auditIssuesLabel, W } from "./fin-words";
import { auditFingerprint, latestAuditRun } from "./self-audit";
import { weeklySteps } from "./weekly-steps";
import { closeChecksOf } from "./weekly-close";
import { monthCloseStatusRead, type MonthCloseInfo } from "./month-close-status";

export type { MonthCloseInfo };

export interface CloseCheck {
  /** 항목 이름 — 화면이 순서가 아니라 이름으로 고른다 (2026-09-11 첫 화면 개편).
   *  posclose 는 2026-09-12 에 뺐다 — 카드 단계 status 에 「안 된 날 N일」이 이미 있고 soft 였다. */
  key: "upload" | "card" | "deposits" | "expenses" | "tax" | "payables" | "zero" | "health"
    /** ⭐ 정합성 검사 A2~A4 (개편 5단계, 2026-09-13 — 첫 화면 배너를 없애고 여기 한 줄로. 사장님 결정 8) */
    | "audit";
  ok: boolean;
  text: string;
  href: string;
  /** 참고 항목 — ⚠ 로 보여 주되 마감을 막지 않는다 (자료 컷오프·카드 차이·미지급·0원 매입) */
  soft?: boolean;
}

/** 읽기는 month-close-status.ts (weekly-steps 와의 import 고리를 끊으려고 뗌, 2026-09-12) — 호출처는 그대로 여기서 */
export async function monthCloseStatus(ym: string): Promise<MonthCloseInfo> {
  return monthCloseStatusRead(ym);
}

/**
 * 마감 조건 체크리스트 — 미충족 항목은 그 화면으로 가는 링크가 된다
 *
 * ⭐ 2026-09-12 (개편 3단계): 「이번 주 정리」 정본 weeklySteps **한 벌**에서 뽑는다 (weekly-close.closeChecksOf).
 *    전엔 여기서 9줄을 다시 만들어 목록이 두 벌이었다 — 계산서 taxOpenCount vs taxOpenCounts,
 *    미지급 payablesData vs payableTotal 로 미세하게 갈렸다.
 * 🔴 마감 판정 불변: 마감을 막는 hard 3항목(입금·지출·계산서)은 weeklySteps 가 같은 함수
 *    (depositOpenCount·expenseOpen·taxOpenCounts = taxOpenCount 의 buy+sell)로 센다.
 *    2026 감사 N1·N2·N3(각 화면과 같은 함수) · 2025 F6(모든 달 같은 기준) 원칙 그대로.
 *    바뀌는 것은 글자(단계 status 문구)뿐. posclose 항목은 카드 단계에 흡수(soft 였다).
 */
export async function closeChecklist(ym: string, healthOk?: boolean): Promise<CloseCheck[]> {
  const w = await weeklySteps(ym);
  const hOk = healthOk ?? (await finHealth()).allOk;
  /* 🔴 2025 감사 F6: 자료 검증은 「최근 60일·최근 3달」 기준이라 지난 달(특히 2025) 마감과
     무관하다 — 지난 달은 경고만 보이고 마감을 막지 않는다 */
  const past = ym < kstToday().slice(0, 7);
  /* 🔴 2026 감사 R3: 0원 매입은 참고(soft) — 막지는 않고 ⚠ 만 */
  const zeroN = await zeroTotalInvoiceCount();
  const zero: CloseCheck | null =
    zeroN > 0
      ? { key: "zero", ok: false, soft: true, text: `금액 없는 매입 장부 ${zeroN}건 — 단가를 채워 주세요`, href: "/receiving" }
      : null;
  const health: CloseCheck = {
    key: "health",
    ok: hOk || past,
    text: hOk ? "자료 검증 ✓" : past ? "자료 검증 경고 있음 (최근 자료 기준 — 지난 달 마감은 막지 않음)" : "자료 검증 경고 있음",
    href: `/finance/ledger?ym=${ym}`,
  };
  const audit = await auditCheck(ym);
  return closeChecksOf(w, { zero, health, audit });
}

/**
 * ⭐ 정합성 검사 한 줄 (개편 5단계, 2026-09-13 — 사장님 결정 8 「장부 마감 체크리스트에 한 줄」)
 *
 *   첫 화면 배너(A2~A4)를 없애며 여기로 왔다. A1(안 들어온 이체)은 「오늘」 칸이 같은 함수로 보여 주므로 뺀다.
 * 🔴 **읽기만** — 저장본(latestAuditRun)과 지금 지문(auditFingerprint) 두 질의. 전에 배너가 하던
 *    「지문이 다르면 그 자리에서 다시 돌려 저장」은 GET 중 쓰기이고 A1 이 판매 60건×후보 질의라 뺐다.
 *    지문이 다르면 「자료가 바뀜 — 다시 검사」라고 **적기만** 한다. 다시 돌리는 건 장부 화면의
 *    「지금 다시 검사」 단추(trace-actions.runAuditNow)와 아침 07:30 cron 둘.
 *   soft — 마감을 막지 않는다(hard 3 은 입금·지출·계산서 그대로).
 */
async function auditCheck(ym: string): Promise<CloseCheck> {
  const href = `/finance/ledger?ym=${ym}#audit`;
  const last = await latestAuditRun();
  if (!last) return { key: "audit", ok: false, soft: true, text: W.auditNone, href };
  const fp = await auditFingerprint();
  const stale = last.fingerprint !== null && last.fingerprint !== fp;
  const issues = last.items.filter((it) => it.code !== "A1");
  const when = `(${last.at} 기준)`;
  const tail = stale ? ` · ${W.auditStale}` : "";
  if (issues.length === 0) {
    return { key: "audit", ok: !stale, soft: true, text: `${W.auditOk} ${when}${tail}`, href };
  }
  return { key: "audit", ok: false, soft: true, text: `${auditIssuesLabel(issues.length)} ${when}${tail}`, href };
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
