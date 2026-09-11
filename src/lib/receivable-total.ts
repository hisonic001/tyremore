/**
 * ⭐ 「못 받은 돈」 총액 정본 (돈관리 개편 1단계, 2026-09-11)
 *
 *   첫 화면 「이번 달 돈」 칸 · 장부 「지금 기준」 칸 · 정비 내역 미수금 배너 · 폰 화면이
 *   **같은 숫자**를 쓴다. 전엔 현황(page.tsx 인라인)·정비 내역 배너(인라인)·외상 장부
 *   (receivable-book)가 각자 세어 예약 몫 분리 여부가 화면마다 달랐다.
 *
 *   모집단은 receivable-book.ts 와 글자 그대로 같다: 성사 · 외상 · 잔액 > 0.
 *   예약 잔금은 **빼지 않고 갈라만 둔다**(독촉할 돈이 아니라 시공하러 오시면 받을 돈).
 *   화면이 「독촉할 외상 = total − reserve」 로 보여 준다.
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 하나.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface ReceivableTotal {
  /** 잔액 있는 외상 건수 (예약 포함) */
  count: number;
  /** 잔액 합 (예약 포함) */
  remain: number;
  /** 그중 예약(시공 전) 몫 */
  reserveCount: number;
  reserveRemain: number;
}

export async function receivableTotal(): Promise<ReceivableTotal> {
  const [r] = await db.execute<{ n: number; remain: string; rn: number; rremain: string }>(sql`
    SELECT count(*) FILTER (WHERE q.reservation_status IS DISTINCT FROM '예약중')::int n,
           COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0))
                    FILTER (WHERE q.reservation_status IS DISTINCT FROM '예약중'), 0)::bigint remain,
           count(*) FILTER (WHERE q.reservation_status = '예약중')::int rn,
           COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0))
                    FILTER (WHERE q.reservation_status = '예약중'), 0)::bigint rremain
    FROM quote q
    LEFT JOIN (SELECT quote_id, SUM(amount) paid FROM receivable_payment GROUP BY 1) rp ON rp.quote_id = q.id
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.total_amount > COALESCE(rp.paid, 0)
  `);
  const n = Number(r?.n ?? 0);
  const rn = Number(r?.rn ?? 0);
  const remain = Number(r?.remain ?? 0);
  const rremain = Number(r?.rremain ?? 0);
  return { count: n + rn, remain: remain + rremain, reserveCount: rn, reserveRemain: rremain };
}
