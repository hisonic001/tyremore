/**
 * 🔴 2025 진행(2026-08-27)에서 터진 실버그: recon_match.method CHECK 가 '자동'·'수동' 뿐이라
 * 허용 오차 정리(confirmTaxToBanks 의 잔돈 absorbed·차액 settled, method '조정')가 **항상** 실패했다
 * — 유일이엔티 근사 묶음 「한 번에 잇기」가 배포 뒤 한 번도 성공할 수 없던 상태. '조정'을 허용한다.
 *   npx tsx -r dotenv/config scripts/add-recon-method-adjust.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
async function main() {
  await db.execute(sql`ALTER TABLE recon_match DROP CONSTRAINT IF EXISTS recon_match_method_check`);
  await db.execute(sql`ALTER TABLE recon_match ADD CONSTRAINT recon_match_method_check CHECK (method IN ('자동', '수동', '조정'))`);
  const [r] = await db.execute<{ c: string }>(sql`SELECT pg_get_constraintdef(oid) c FROM pg_constraint WHERE conname = 'recon_match_method_check'`);
  console.log("✅", r.c);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
