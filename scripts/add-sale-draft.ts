/**
 * ⭐ 판매 임시저장 서버 보관 (사장님 요청 2026-09-07)
 *
 *   "임시저장된 내용은 다른 계정들에서도 공유가 가능해서 같이 볼 수 있어야 함."
 *   지금까지는 localStorage(기기별)라 폰에서 접어둔 것을 매장 PC 가 못 봤다.
 *   계정 필터 없이 한 표를 다 같이 본다 — 매장은 한 팀이다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-sale-draft.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sale_draft (
      id bigserial PRIMARY KEY,
      label text NOT NULL,
      state jsonb NOT NULL,
      created_by bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const [chk] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM sale_draft`);
  console.log(`sale_draft 준비됨 — 현재 ${chk.n}건`);
  process.exit(0);
}
main();
