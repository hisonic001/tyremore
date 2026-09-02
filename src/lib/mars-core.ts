/**
 * ⭐ MARS 도장 — 코어 (2026-09-02)
 *
 *   「이 판매는 MARS 에 들어갔다」 도장을 찍는 실제 일. 부르는 문이 둘이다:
 *   · 웹 액션 markEntered(mars-queue.ts) — hasPerm("mars") 게이트 뒤에서
 *   · 매장 PC 로봇(scripts/mars-fill.ts) — 요청 밖 실행이라 세션이 없다.
 *     DATABASE_URL 을 쥔 로컬 실행이라 이미 전체 신뢰 수준 — 게이트 없이 코어를 직접 부른다
 *     (settlement-apply·recon-core 의 Core 관례와 같은 지위).
 *
 * 🔴 실사고 기록 (2026-09-02): markEntered 에 hasPerm 게이트를 달자 로봇이
 *    「cookies was called outside a request scope」 로 5회 죽었고, MARS 입력은
 *    성공한 뒤 도장만 실패해 Q26-0902-005 가 3회·007 이 2회 중복 입력됐다.
 *    게이트(웹)와 일(코어)을 나누는 것이 정답이다 — 인증 코드에 예외-통과
 *    분기를 넣는 우회는 하지 않는다.
 *
 * 🔴 "use server" 아님 — 공개 엔드포인트가 아니다.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quote } from "@/db/schema";

export async function markEnteredCore(
  quoteId: number,
  refNo?: string | null,
  memo?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [q] = await db.select({ id: quote.id }).from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };

  await db
    .update(quote)
    .set({
      marsStatus: "전송완료",
      marsSyncedAt: new Date(),
      marsRefNo: refNo?.trim() || null,
      marsMemo: memo?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));
  return { ok: true };
}
