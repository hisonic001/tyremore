/** #96 점검 실행이 끝날 때까지 기다렸다 상태를 찍는다 — 읽기만 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
async function main() {
  for (;;) {
    const [r] = await db.execute<{ status: string }>(sql`SELECT status FROM mars_run WHERE id = 96`);
    if (r && r.status !== "대기" && r.status !== "실행중") {
      console.log(`run96:${r.status}`);
      break;
    }
    await new Promise((res) => setTimeout(res, 60_000));
  }
  const [left] = await db.execute<{ noref: number; nochk: number }>(sql`
    SELECT count(*) FILTER (WHERE mars_ref_no IS NULL)::int noref,
           count(*) FILTER (WHERE vehicle_check_at IS NULL)::int nochk
    FROM quote WHERE status='성사' AND mars_status='전송완료' AND quote_no LIKE 'Q%'
  `);
  console.log(`남은 것 — 송장 없음 ${left.noref}건 · 점검 안 됨 ${left.nochk}건`);
  process.exit(0);
}
main();
