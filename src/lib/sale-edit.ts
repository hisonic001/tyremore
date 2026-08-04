"use server";

/**
 * 정비 내역 수정·취소 (사장님 요청 2026-08-04)
 *
 *   "정비내역이 시스템에 저장되고 관리되고 수정되고 삭제도 가능해야함."
 *
 * 지금까지는 판매를 등록하면 **되돌릴 길이 없었다.** 수량을 잘못 치면 재고가
 * 어긋난 채로 고칠 방법이 없었다. 스키마는 처음부터 약속하고 있었다 —
 *   "취소 → 성사였다면 재고를 되돌린다" (quote.status 주석)
 * 이제야 그 약속을 지킨다.
 *
 * 🔴 **지우지 않고 「취소」로 남긴다.** 지워 버리면 「그날 무슨 일이 있었나」가
 *    사라진다. 잘못 등록한 것도 기록이다 — 화면에서 취소 표시로 보여 준다.
 *
 * 🔴 재고 복원은 **입출고 이력(stock_movement)을 근거로** 한다.
 *    부품은 판매 때 행이 남고 수량만 줄기 때문에, 어느 행에서 몇 개를 뺐는지는
 *    이력에만 정확히 남아 있다. 짐작으로 되돌리면 실물과 어긋난다.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote, stockItem, stockMovement } from "@/db/schema";

function refresh() {
  for (const p of ["/sales", "/mars", "/", "/stock"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

/** 작업일 · 결제수단 · 메모를 고친다 — 금액과 품목은 여기서 못 고친다 */
export async function updateSaleHead(input: {
  quoteId: number;
  workDate?: string | null;
  paymentMethod?: string | null;
  paymentMemo?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status })
    .from(quote)
    .where(eq(quote.id, input.quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매는 고칠 수 없습니다" };

  const workDate = input.workDate?.trim() || null;
  if (workDate && !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return { ok: false, error: "날짜는 2026-08-04 형식입니다" };
  }
  const pay = input.paymentMethod?.trim() || null;
  if (pay && !["현금", "카드", "계좌이체", "외상", "혼합"].includes(pay)) {
    return { ok: false, error: "결제수단이 올바르지 않습니다" };
  }

  await db
    .update(quote)
    .set({
      ...(workDate ? { workDate } : {}),
      paymentMethod: pay,
      paymentMemo: input.paymentMemo?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, input.quoteId));

  refresh();
  return { ok: true };
}

/**
 * ⭐ 판매 취소 — 재고가 되살아난다.
 *
 * @param confirmMars MARS 에 이미 들어간 판매(전송완료)를 취소할 때는
 *                    이 확인이 있어야 한다. 우리 쪽만 취소하면 MARS 와 어긋나는데,
 *                    그걸 알고 누르시는 건지 화면이 한 번 더 묻는다.
 */
export async function cancelSale(
  quoteId: number,
  confirmMars = false,
  userId?: number,
): Promise<
  | { ok: true; restored: number; marsWarning: string | null }
  | { ok: false; error: string; needMarsConfirm?: boolean }
> {
  const [q] = await db
    .select({ id: quote.id, status: quote.status, marsStatus: quote.marsStatus, quoteNo: quote.quoteNo })
    .from(quote)
    .where(eq(quote.id, quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "이미 취소된 판매입니다" };

  if (q.marsStatus === "전송완료" && !confirmMars) {
    return {
      ok: false,
      needMarsConfirm: true,
      error:
        "이 판매는 MARS 에 이미 들어갔습니다. 여기서 취소해도 MARS 에는 남아 있으니 " +
        "MARS 에서도 직접 지우셔야 합니다. 그래도 취소할까요?",
    };
  }

  /**
   * 재고 복원 — 이 판매의 출고 이력을 하나씩 되감는다.
   *   타이어(1본 1행): 판매완료 행을 재고로 되돌린다
   *   부품(수량 행):   줄었던 수량을 다시 더한다
   */
  const moves = await db
    .select({ id: stockMovement.id, stockItemId: stockMovement.stockItemId, qtyDelta: stockMovement.qtyDelta })
    .from(stockMovement)
    .where(and(eq(stockMovement.quoteId, quoteId), eq(stockMovement.type, "출고")));

  let restored = 0;
  const now = new Date();
  for (const m of moves) {
    const take = -m.qtyDelta; // 출고는 음수로 남는다
    if (take <= 0) continue;
    const [item] = await db
      .select({ id: stockItem.id, status: stockItem.status, qty: stockItem.qty, quoteId: stockItem.quoteId })
      .from(stockItem)
      .where(eq(stockItem.id, m.stockItemId))
      .limit(1);
    if (!item) continue;

    if (item.status === "판매완료" && item.quoteId === quoteId) {
      await db
        .update(stockItem)
        .set({ status: "재고", soldAt: null, quoteId: null })
        .where(eq(stockItem.id, item.id));
    } else {
      // 부품 — 행은 그대로 있고 수량만 줄어 있었다
      await db.update(stockItem).set({ qty: item.qty + take }).where(eq(stockItem.id, item.id));
    }
    await db.insert(stockMovement).values({
      stockItemId: item.id,
      type: "반품",
      reason: "판매취소",
      qtyDelta: take,
      quoteId,
      memo: `${q.quoteNo} 취소`,
      createdBy: userId ?? null,
    });
    restored += take;
  }

  const marsWarning =
    q.marsStatus === "전송완료"
      ? "MARS 에는 아직 남아 있습니다 — MARS 매출 주문(또는 송장)을 직접 지워 주세요"
      : null;

  await db
    .update(quote)
    .set({
      status: "취소",
      ...(marsWarning
        ? { marsMemo: sql`COALESCE(${quote.marsMemo} || ' · ', '') || '취소됨 — MARS 에서도 삭제 필요'` }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  refresh();
  return { ok: true, restored, marsWarning };
}
