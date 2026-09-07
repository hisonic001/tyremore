/**
 * ⭐ 수금 수단 「개인계좌」 (사장님 제보 2026-09-07)
 *
 *   강원수산 외상 수금을 개인계좌로 받았는데 돈관리에 안 보였다 — 법인 통장
 *   자료에 없는 수령이라서다. 수금 수단에 「개인계좌」를 더해 구분해 남기고,
 *   돈관리 홈이 「통장 밖 수령」으로 따로 보여 준다 (COLLECT_METHODS 정본과 한 벌).
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-collect-personal.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`ALTER TABLE receivable_payment DROP CONSTRAINT IF EXISTS receivable_payment_method_check`);
  await db.execute(sql`
    ALTER TABLE receivable_payment ADD CONSTRAINT receivable_payment_method_check
      CHECK (method IN ('현금','카드','계좌이체','지역화폐','간편결제','개인계좌'))
  `);
  const [chk] = await db.execute<{ def: string }>(sql`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname='receivable_payment_method_check'`);
  console.log("제약 갱신됨 —", chk.def.includes("개인계좌") ? "개인계좌 포함 ✓" : "⚠️ 확인 필요");
  process.exit(0);
}
main();
