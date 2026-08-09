/**
 * 일회성 (2026-08-09) — MARS 흐름 전환의 뒷정리.
 *
 * 판매 등록이 자동으로 '미전송'(=대기열)에 올리던 것을 '보류'(안 올림)로 바꿨다.
 * 이미 '미전송' 으로 남아 있던 판매들을 '보류' 로 돌려, 사장님이 정비 내역에서
 * **직접 체크한 것만** 올라가게 한다. 실행: npx tsx scripts/mars-backlog-to-hold.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

async function main() {
  const before = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM quote WHERE mars_status = '미전송'`,
  );
  const rows = await db.execute<{ id: number; quote_no: string }>(sql`
    UPDATE quote SET mars_status = '보류', updated_at = now()
    WHERE mars_status = '미전송'
    RETURNING id, quote_no
  `);
  console.log(`미전송 ${before[0].n}건 → 보류 ${rows.length}건 전환:`);
  for (const r of rows) console.log(`  ${r.quote_no}`);
  process.exit(0);
}

void main();
