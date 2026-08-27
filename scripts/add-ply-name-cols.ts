/**
 * 품목 칸 둘 추가 (사장님 요청 2026-08-27 — 품목명 규칙화)
 *
 *   ply_rating  겹수(PR). 「세부사항」에 칸이 없어 이름에만 있었다 —
 *               이름에서 겹수를 빼기로 했으니 저장할 자리가 필요하다.
 *   name_auto   규칙이 만든 이름. 다시 돌릴 때 `display_name` 과 다르면
 *               **사장님이 고친 것**이므로 건드리지 않는다.
 *
 *   npx tsx -r dotenv/config scripts/add-ply-name-cols.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`ALTER TABLE product ADD COLUMN IF NOT EXISTS ply_rating integer`);
  await db.execute(sql`ALTER TABLE product ADD COLUMN IF NOT EXISTS name_auto text`);
  const r = await db.execute<{ c: string; t: string }>(sql`
    SELECT column_name c, data_type t FROM information_schema.columns
    WHERE table_name = 'product' AND column_name IN ('ply_rating', 'name_auto') ORDER BY 1`);
  console.log("✅", JSON.stringify(r));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
