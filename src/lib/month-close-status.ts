/**
 * ⭐ 월 마감 상태 읽기 — month-close.ts 에서 떼어낸 조회 (개편 3단계, 2026-09-12)
 *
 *   왜 떼었나: 마감 체크리스트(closeChecklist)가 이제 「이번 주 정리」 정본 weeklySteps 를 쓰는데,
 *   weeklySteps 는 지난달이 마감됐는지 보려고 monthCloseStatus 를 부른다. 둘이 같은 파일에 있으면
 *   month-close ↔ weekly-steps 가 서로 import 하는 고리가 된다. 읽기만 여기로 빼서 고리를 끊는다.
 *   기존 호출처(ledger·month-close)는 month-close.ts 의 같은 이름 함수를 그대로 쓴다(그 함수가 이걸 부른다).
 *
 * 🔴 "use server" 아님 — 조회 전용.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface MonthCloseInfo {
  closed: boolean;
  closedAt: string | null;
  profit: number | null;
  /** 앱 판매·매입 기록이 있는 달인가 — 없으면(2025) 손익은 의미가 없어 「자료 기준 마감」으로 표시 */
  dataComplete: boolean;
}

export async function monthCloseStatusRead(ym: string): Promise<MonthCloseInfo> {
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
