"use server";

/**
 * ⭐ 지출 분류 — 쓰기 액션 (ERP ⑥, 사장님 지시 2026-08-25)
 *
 *   통장 출금·법인카드 지출에 분류를 붙인다. 한 번 붙이면 같은 상대(expense_rule)의
 *   과거 미분류 지출에 일괄 적용되고, 새로 올리는 파일에도 자동으로 붙는다(fin-ingest).
 *
 * 🔴 사장님 전용. 분류 목록·상대명 규칙은 recon-data(EXPENSE_CATS·payerKeyOf) 한 곳.
 */
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isOwner } from "@/lib/auth";
import { EXPENSE_CATS, payerKeyOf } from "./expense-cats";

export async function setExpenseCategory(
  cashTxnId: number,
  category: string | null,
): Promise<{ ok: true; applied: number; payer: string } | { ok: false; error: string }> {
  if (!(await isOwner())) return { ok: false, error: "돈 관리는 사장님 계정 전용입니다" };
  if (category !== null && !(EXPENSE_CATS as readonly string[]).includes(category)) {
    return { ok: false, error: "분류가 올바르지 않습니다" };
  }
  const [row] = await db.execute<{ id: number; source: string; description: string; out_amount: number }>(sql`
    SELECT id, source, description, out_amount FROM cash_txn WHERE id = ${cashTxnId} AND is_active
  `);
  if (!row) return { ok: false, error: "지출 줄을 찾을 수 없습니다" };
  if (Number(row.out_amount) <= 0) return { ok: false, error: "지출(출금) 줄이 아닙니다" };

  await db.execute(sql`UPDATE cash_txn SET category = ${category} WHERE id = ${cashTxnId}`);
  let applied = 1;
  const key = payerKeyOf(row.source, row.description);

  if (category === null) {
    // 분류 해제 — 규칙도 지운다 (같은 상대를 계속 잘못 붙이지 않게)
    await db.execute(sql`DELETE FROM expense_rule WHERE key = ${key}`);
  } else if (key.length >= 2) {
    await db.execute(sql`
      INSERT INTO expense_rule (key, category) VALUES (${key}, ${category})
      ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, updated_at = now()
    `);
    // 같은 상대의 분류 안 된 지출에 일괄 적용 — 과거 것까지 한 번에
    const bulk = await db.execute<{ id: number }>(sql`
      UPDATE cash_txn SET category = ${category}
      WHERE category IS NULL AND is_active AND out_amount > 0
        AND (CASE WHEN source = '통장'
              THEN trim(regexp_replace(description, '^\[[^\]]*\] *', ''))
              ELSE trim(description) END) = ${key}
      RETURNING id
    `);
    applied += bulk.length;
  }

  revalidatePath("/finance/expenses");
  revalidatePath("/finance");
  return { ok: true, applied, payer: key };
}
