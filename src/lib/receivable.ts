"use server";

/**
 * ⭐ 외상·수금 관리 (사장님 선택 2026-08-11)
 *
 * 외상 판매는 지금까지 payment_method='외상' 글자 하나로만 남았다 — 얼마를 받았고
 * 얼마가 남았는지는 사장님 머릿속에만 있었다. 이제 수금을 한 번 받을 때마다
 * receivable_payment 에 한 줄씩 남기고, 잔액은 합계에서 뺀 파생값으로 보여준다.
 *
 * · 완납돼도 payment_method 는 '외상' 그대로 둔다 — 외상으로 판 기록 자체가 사실이다.
 *   실결제 수단으로 바꾸고 싶으면(MARS 에 올리려면) 「날짜·결제 고치기」로 바꾼다.
 * · MARS 와 무관 — 외상 건은 어차피 MARS 자동 입력에서 빠진다.
 */

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote, receivablePayment } from "@/db/schema";
import { getSession } from "./auth";

function refresh() {
  for (const p of ["/sales", "/"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

const METHODS = ["현금", "카드", "계좌이체", "지역화폐"];

export interface CollectionRow {
  id: number;
  amount: number;
  method: string;
  paidOn: string;
  memo: string | null;
}

/** 수금 입력 — 외상 건만, 잔액을 넘게는 못 받는다 */
export async function addCollection(input: {
  quoteId: number;
  amount: number;
  method: string;
  paidOn?: string | null;
  memo?: string | null;
}): Promise<{ ok: true; remain: number } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "금액이 올바르지 않습니다" };
  if (!METHODS.includes(input.method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const paidOn = input.paidOn?.trim() || null;
  if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: "날짜는 2026-08-11 형식입니다" };

  const [q] = await db
    .select({ id: quote.id, status: quote.status, pay: quote.paymentMethod, total: quote.totalAmount })
    .from(quote)
    .where(eq(quote.id, input.quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매입니다" };
  if (q.pay !== "외상") return { ok: false, error: "외상 판매가 아닙니다" };

  const [paid] = await db.execute<{ s: number }>(sql`
    SELECT COALESCE(SUM(amount), 0)::int s FROM receivable_payment WHERE quote_id = ${q.id}
  `);
  const remainBefore = q.total - Number(paid?.s ?? 0);
  if (amount > remainBefore) {
    return { ok: false, error: `잔액(${remainBefore.toLocaleString()}원)보다 많이 받을 수 없습니다` };
  }

  await db.insert(receivablePayment).values({
    quoteId: q.id,
    amount,
    method: input.method,
    ...(paidOn ? { paidOn } : {}),
    memo: input.memo?.trim() || null,
  });
  refresh();
  return { ok: true, remain: remainBefore - amount };
}

/** 잘못 넣은 수금 지우기 */
export async function removeCollection(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await getSession())) return { ok: false, error: "로그인이 필요합니다" };
  await db.delete(receivablePayment).where(eq(receivablePayment.id, id));
  refresh();
  return { ok: true };
}
