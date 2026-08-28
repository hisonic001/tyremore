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
import { isOwner } from "./auth";
import { planSettlement } from "./receivable-plan";

function refresh() {
  for (const p of ["/sales", "/", "/receivables"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

const METHODS = ["현금", "카드", "계좌이체", "지역화폐"];

/**
 * ⭐ 돈 관리는 사장님 전용 (2회차 수리 E1, 사장님 결정 2026-08-28)
 *
 * 🔴 **왜 바꿨나** — 거울상인 매입 지급(purchase-pay.ts)은 네 함수 모두 isOwner() 인데
 *    이쪽 외상은 셋 다 getSession() 이었다. 같은 「돈 관리」인데 기준이 두 벌이라,
 *    직원 계정(role='tech')으로도 외상을 한꺼번에 털고 수금 기록을 지울 수 있었다.
 *    사장님 결정: **매입 지급과 같은 기준으로 맞춘다.**
 *
 * 🔴 되돌리려면 이 한 줄을 getSession() 으로 바꾸면 된다 — 세 곳이 이걸 같이 쓴다.
 */
const OWNER_ONLY = { ok: false as const, error: "돈 관리는 사장님 계정 전용입니다" };

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
  if (!(await isOwner())) return OWNER_ONLY; // 2회차 수리 E1
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

/* ============================================================
 * ⭐ 한꺼번에 털기 (사장님 지시 2026-08-17)
 *   "거래처별로 내역을 확인하고 한번에 외상을 떨어버릴 수 있는 방법
 *    (한꺼번에 입금하는 경우도 있음)도 필요함"
 * ========================================================== */

/**
 * 여러 건을 한 번에 수금한다.
 *
 * 🔴 addCollection 을 반복해 부르지 않는다:
 *    ① 건마다 조회+삽입 2왕복 — 20건이면 40왕복이다 (커넥션 풀로 두 번 마비된 이력)
 *    ② 중간에 한 건이 막히면 앞 건은 이미 들어가 있다. 「한꺼번에」는
 *       전부 되거나 전부 아니거나여야 한다.
 *    대신 잔액 배분 규칙은 planSettlement 한 곳에 모아 화면과 같이 쓴다.
 */
export async function settleReceivables(input: {
  quoteIds: number[];
  method: string;
  paidOn?: string | null;
  memo?: string | null;
  /** 실제로 받은 총액. 비우면 고른 건들의 잔액 전부 */
  received?: number | null;
}): Promise<
  | { ok: true; settled: number; applied: number; partialQuoteNo: string | null }
  | { ok: false; error: string }
> {
  if (!(await isOwner())) return OWNER_ONLY; // 2회차 수리 E1
  if (!METHODS.includes(input.method)) return { ok: false, error: "수단이 올바르지 않습니다" };
  const paidOn = input.paidOn?.trim() || null;
  if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return { ok: false, error: "날짜는 2026-08-17 형식입니다" };
  }
  const ids = [...new Set(input.quoteIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (ids.length === 0) return { ok: false, error: "털 건을 골라 주세요" };

  try {
    return await db.transaction(async (tx) => {
      /**
       * 🔴 `= ANY(배열)` 은 쓰지 않는다 — drizzle 이 JS 배열을 Postgres 배열로 못 묶어
       *    「malformed array literal」로 죽는다 (2026-08-15 실서비스 500).
       * 🔴 FOR UPDATE — 읽고 넣는 사이에 다른 사람이 그 건에 수금을 넣으면 잔액을 넘긴다.
       */
      const inList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
      const rows = await tx.execute<{
        id: number;
        quote_no: string;
        status: string;
        payment_method: string | null;
        total_amount: number;
        paid: number;
      }>(sql`
        SELECT q.id, q.quote_no, q.status, q.payment_method, q.total_amount,
               COALESCE((SELECT SUM(amount)::int FROM receivable_payment rp WHERE rp.quote_id = q.id), 0) paid
        FROM quote q
        WHERE q.id IN (${inList})
        ORDER BY COALESCE(q.work_date, q.created_at::date) ASC, q.id ASC
        FOR UPDATE OF q
      `);
      if (rows.length !== ids.length) throw new Error("없는 판매가 섞여 있습니다");

      /** 하나라도 어긋나면 통째로 거부 — 되돌리는 것보다 안 넣는 것이 낫다 */
      for (const r of rows) {
        if (r.status === "취소") throw new Error(`${r.quote_no} 는 취소된 판매입니다`);
        if (r.payment_method !== "외상") throw new Error(`${r.quote_no} 는 외상 판매가 아닙니다`);
        if (Number(r.total_amount) - Number(r.paid) <= 0) {
          throw new Error(`${r.quote_no} 는 이미 다 받았습니다`);
        }
      }

      const open = rows.map((r) => ({
        quoteId: Number(r.id),
        quoteNo: r.quote_no,
        remain: Number(r.total_amount) - Number(r.paid),
      }));
      const totalRemain = open.reduce((s, r) => s + r.remain, 0);
      const received = input.received == null ? totalRemain : Math.round(Number(input.received));
      if (!Number.isFinite(received) || received <= 0) throw new Error("받은 금액이 올바르지 않습니다");
      if (received > totalRemain) {
        throw new Error(`고른 건들의 잔액(${totalRemain.toLocaleString()}원)보다 많이 받을 수 없습니다`);
      }

      const { plan, partialQuoteNo } = planSettlement(open, received);
      if (plan.length === 0) throw new Error("넣을 수금이 없습니다");

      await tx.insert(receivablePayment).values(
        plan.map((p) => ({
          quoteId: p.quoteId,
          amount: p.amount,
          method: input.method,
          ...(paidOn ? { paidOn } : {}),
          memo: input.memo?.trim() || null,
        })),
      );
      return {
        ok: true as const,
        settled: plan.length,
        applied: received,
        partialQuoteNo,
      };
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message || "수금을 넣지 못했습니다" };
  } finally {
    refresh();
  }
}

/**
 * 잘못 넣은 수금 지우기
 *
 * 🔴 2회차 수리 E1(2026-08-28): 두 가지를 고쳤다 —
 *    ① 사장님 전용으로 (매입 지급의 removePurchasePayment 와 같은 기준)
 *    ② **0건 지우고도 「됐습니다」 하던 것.** 전에는 없는 id 를 줘도 그냥 ok 를 돌려줘,
 *       화면은 지워진 줄 알고 새로 고치는데 아무것도 안 바뀌었다.
 *       (2회차 보고 「눌렀는데 0건 처리하고 조용히 끝나는 것」)
 */
export async function removeCollection(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return OWNER_ONLY; // 2회차 수리 E1
  const gone = await db.delete(receivablePayment).where(eq(receivablePayment.id, id)).returning({ id: receivablePayment.id });
  if (gone.length === 0) return { ok: false, error: "그 수금 기록이 이미 없습니다 — 새로 고쳐 보세요" };
  refresh();
  return { ok: true };
}
