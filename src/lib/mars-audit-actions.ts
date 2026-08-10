"use server";

/**
 * ⭐ MARS 정합 감사의 「정리됨」 처리 (2026-08-11).
 *
 * 감사 배너의 「전기 미확인」에는 사장님이 이미 MARS 에서 직접 전기하신 건도 섞인다
 * (초기 수기 입력 건 등) — 우리 쪽에 송장 번호가 안 남았을 뿐이다.
 * 그런 건은 이 버튼으로 「수동확인」 도장을 찍어 배너에서 내린다.
 * 🔴 실제로 전기가 안 된 건에 찍으면 어긋남이 숨는다 — 버튼 문구가 그래서 단호하다.
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote } from "@/db/schema";
import { getSession } from "./auth";

export async function markMarsResolved(
  quoteId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "로그인이 필요합니다" };

  const [q] = await db
    .select({ id: quote.id, marsStatus: quote.marsStatus, refNo: quote.marsRefNo })
    .from(quote)
    .where(eq(quote.id, quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
  if (q.marsStatus !== "전송완료" || q.refNo) return { ok: false, error: "정리할 대상이 아닙니다" };

  await db.execute(sql`
    UPDATE quote SET mars_ref_no = '수동확인',
      mars_memo = COALESCE(mars_memo || ' · ', '') || 'MARS 에서 직접 확인 (감사 정리)',
      updated_at = now()
    WHERE id = ${quoteId}
  `);
  try {
    revalidatePath("/sales");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}
