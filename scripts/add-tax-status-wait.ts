/**
 * 세금계산서에 「대기」 상태 추가 (사장님 질문 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/add-tax-status-wait.ts
 *
 *   "7월 매출 입금의 경우 카랑은 보통 다음달에 입금을 해주는데
 *    아직 안 들어온 건 어떻게 처리해야하나?"
 *
 * 지금까지는 둘 중 하나뿐이었다 —
 *   · 「미대조」로 두면 그 달이 영영 안 닫히고 매달 같은 줄을 다시 본다
 *   · 「무시」로 두면 셈에서 빠지는데, 그건 **받을 돈을 잊는다**는 뜻이다
 *
 * 그래서 「대기」를 만든다. 뜻은 **"아직 안 들어왔다. 다음에 들어온다."**
 *   · 이 달 「돈 확인할 것」에서 빠진다 → 달을 닫을 수 있다
 *   · 「아직 안 들어온 돈」 카드에 남는다 → 잊지 않는다
 *   · 통장 후보 풀에는 그대로 있다 → 다음 달 입금이 오면 그때 이으면 '확정'이 된다
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  const [before] = await db.execute<{ def: string }>(sql`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conrelid = 'tax_invoice'::regclass AND conname = 'tax_invoice_recon_status_check'`);
  console.log(`지금: ${before?.def ?? "(제약 없음)"}`);
  if (before?.def?.includes("대기")) {
    console.log("이미 「대기」가 들어 있습니다 — 할 일 없음");
    process.exit(0);
  }

  await db.execute(sql`ALTER TABLE tax_invoice DROP CONSTRAINT IF EXISTS tax_invoice_recon_status_check`);
  await db.execute(sql`
    ALTER TABLE tax_invoice ADD CONSTRAINT tax_invoice_recon_status_check
    CHECK (recon_status IN ('미대조', '제안', '확정', '무시', '대기'))`);

  const [after] = await db.execute<{ def: string }>(sql`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conrelid = 'tax_invoice'::regclass AND conname = 'tax_invoice_recon_status_check'`);
  console.log(`고침: ${after?.def}`);

  console.log("\n상태별 계산서:");
  console.log(JSON.stringify(await db.execute(sql`
    SELECT recon_status, count(*)::int n FROM tax_invoice WHERE is_active GROUP BY 1 ORDER BY 2 DESC`)));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
