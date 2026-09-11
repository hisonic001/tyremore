"use server";

/**
 * 계산서 마감 경고 — 「이 거래처는 계산서 안 끊음」 (2026-09-11)
 *   app_setting `invoice_deadline_skip` 에 거래처 이름을 넣고 뺀다. 조회 정본은 invoice-deadline.ts.
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { hasPerm } from "./auth";
import { PERM_DENIED } from "./perm-keys";
import { SKIP_KEY, skipList } from "./invoice-deadline";

export async function setInvoiceDeadlineSkip(
  supplier: string,
  skip: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: PERM_DENIED };
  const name = supplier.trim();
  if (!name) return { ok: false, error: "거래처 이름이 비었습니다" };
  const cur = new Set(await skipList());
  if (skip) cur.add(name);
  else cur.delete(name);
  await db.execute(sql`
    INSERT INTO app_setting (key, value, updated_at) VALUES (${SKIP_KEY}, ${JSON.stringify([...cur])}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
  try {
    revalidatePath("/finance");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}
