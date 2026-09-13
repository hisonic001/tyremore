"use server";

/**
 * 계산서 짝 없음 경고 — 넘기기 (2026-09-11)
 *   사장님: "거래처마다 다르기도 하고 같은 거래처에서도 건마다 다르기 때문에 유동적임."
 *   그래서 둘이다 — scope 'month' = 그 달만("거래처|YYYY-MM"), 'always' = 늘("거래처").
 *   app_setting `invoice_deadline_skip` 에 넣고 뺀다. 조회 정본은 invoice-deadline.ts.
 */
import { revalidatePath } from "next/cache";
import { hasPerm } from "./auth";
import { PERM_DENIED } from "./perm-keys";
import { setSetting } from "./app-setting";
import { SKIP_KEY, skipList } from "./invoice-deadline";

export async function setInvoiceDeadlineSkip(
  supplier: string,
  scope: "month" | "always",
  ym: string | null,
  skip = true,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: PERM_DENIED };
  const name = supplier.trim();
  if (!name) return { ok: false, error: "거래처 이름이 비었습니다" };
  if (scope === "month" && !(ym && /^\d{4}-\d{2}$/.test(ym))) return { ok: false, error: "달이 올바르지 않습니다" };
  const entry = scope === "month" ? `${name}|${ym}` : name;
  const cur = new Set(await skipList());
  if (skip) cur.add(entry);
  else cur.delete(entry);
  await setSetting(SKIP_KEY, JSON.stringify([...cur])); // 공용 정본 (5단계 정리, 2026-09-13)
  try {
    revalidatePath("/finance");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}
