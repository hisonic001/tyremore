/**
 * ⭐ 「오늘 저녁 5분」 정본 (돈관리 개편 1단계, 2026-09-11)
 *
 *   사장님 리듬: 매일 저녁 5분 — 오늘 것만 본다.
 *     ① 오늘 카드 마감  — POS 자료가 있나, 앱과 맞나, 마감했나 (정본 posDaysSummary)
 *     ② 안 들어온 이체  — 계좌이체 판매인데 통장 입금과 안 맞은 것, 판매 그날부터 (정본 a1OpenTransfers)
 *     ③ 오늘 받을 돈    — 오늘 등록된 외상·📌예약 잔금·본사청구 (새 질의 — 기존은 전부 작업일 기준·전 기간)
 *     ④ 전월 계산서     — 매달 1~10일, 아직 안 끊은 거래처 (정본 invoice-deadline)
 *
 *   첫 화면 왼쪽 칸과 폰 화면이 이것 하나를 쓴다. 정합성 A1·인박스·추적 기본 목록이 세 곳에서
 *   따로 보여 주던 ②를 여기 한 곳으로 모은다(사장님 결정 「한 곳으로 합치기」).
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 순차.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { kstToday } from "./ym";
import { posDaysSummary, type PosDaySummary } from "./pos-close";
import { a1OpenTransfers, type A1Row } from "./self-audit";
import { receivablePartySql } from "./receivable-key";
import { invoiceDeadline, type InvoiceDeadline } from "./invoice-deadline";

export interface TodayCard {
  /** 오늘 POS 자료가 올라와 있나 */
  hasPos: boolean;
  closed: boolean;
  posCard: number;
  appCard: number;
  /** 아직 짝 못 맞춘 건수 */
  open: number;
  /** 이 달에 마감 안 된 다른 날 수 (오늘 제외) */
  otherOpenDays: number;
}

export interface TodayReceivable {
  quoteId: number;
  quoteNo: string;
  who: string;
  remain: number;
  total: number;
  /** 'reserve' 예약 잔금 · 'claim' 본사청구 · 'credit' 외상 */
  kind: "reserve" | "claim" | "credit";
}

export interface TodayBrief {
  today: string;
  card: TodayCard;
  transfers: A1Row[];
  newReceivables: TodayReceivable[];
  deadline: InvoiceDeadline;
}

export async function todayBrief(): Promise<TodayBrief> {
  const today = kstToday();
  const ym = today.slice(0, 7);

  const posDays: PosDaySummary[] = await posDaysSummary(ym);
  const t = posDays.find((d) => d.day === today);
  const card: TodayCard = {
    hasPos: !!t,
    closed: t?.closed ?? false,
    posCard: t?.posCard ?? 0,
    appCard: t?.appCard ?? 0,
    open: t?.open ?? 0,
    otherOpenDays: posDays.filter((d) => d.day !== today && !d.closed).length,
  };

  /* 최근 45일 — 정합성 A1 과 같은 창. 「그날 바로」 띄운다(사장님) */
  const from = new Date(Date.parse(today) - 45 * 86400000).toISOString().slice(0, 10);
  const transfers = await a1OpenTransfers({ from });

  /* 🔴 오늘 「등록된」 판매 — created_at 기준 (기존 화면들은 전부 작업일 기준이라 뜻이 다르다) */
  const rows = await db.execute<{
    id: number; quote_no: string; who: string; total: number; paid: string; reservation_status: string | null; claim_party: string | null;
  }>(sql`
    SELECT q.id, q.quote_no,
           COALESCE(${receivablePartySql}, c.name, NULLIF(split_part(q.mars_memo, '·', 1), ''), '이름 없음') who,
           q.total_amount total,
           COALESCE((SELECT SUM(amount) FROM receivable_payment rp WHERE rp.quote_id = q.id), 0)::bigint paid,
           q.reservation_status, q.claim_party
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method = '외상'
      AND (q.created_at AT TIME ZONE 'Asia/Seoul')::date = ${today}::date
    ORDER BY q.id DESC LIMIT 20
  `);
  const newReceivables: TodayReceivable[] = rows
    .map((r) => ({
      quoteId: Number(r.id),
      quoteNo: r.quote_no,
      who: r.who,
      total: Number(r.total),
      remain: Number(r.total) - Number(r.paid),
      kind: (r.reservation_status === "예약중" ? "reserve" : r.claim_party ? "claim" : "credit") as TodayReceivable["kind"],
    }))
    .filter((r) => r.remain > 0);

  const deadline = await invoiceDeadline(today);
  return { today, card, transfers, newReceivables, deadline };
}
