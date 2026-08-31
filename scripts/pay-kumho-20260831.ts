/**
 * ⭐ 미지급 정리 ② — 금호 8/31 이체 5,952,138원 (사장님 확인 2026-08-31 "8월분")
 *   오래된 인보이스부터 선입선출 배분. pay-match-20260831.ts 의 후속.
 *   실행: npx tsx --env-file=.env.local scripts/pay-kumho-20260831.ts [--apply]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** 금호 8/31 이체 5,952,138 (사장님 확인 "8월분") — 오래된 인보이스부터 선입선출 */
const APPLY = process.argv.includes("--apply");
async function main() {
  const rows = await db.execute<{ id: number; invoice_no: string; d: string; total: number; paid: string }>(sql`
    SELECT pi.id, pi.invoice_no, COALESCE(pi.issued_at,'') d, pi.total,
           COALESCE((SELECT SUM(amount) FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
    FROM purchase_invoice pi
    WHERE pi.supplier = '금호' AND pi.status <> '취소' AND pi.total > 0
    ORDER BY COALESCE(pi.issued_at,'9999') ASC, pi.id ASC
  `);
  let left = 5_952_138;
  console.log(APPLY ? "🔴 실행" : "👀 보기만");
  for (const r of rows) {
    if (left <= 0) break;
    const remain = Number(r.total) - Number(r.paid);
    if (remain <= 0) continue;
    const put = Math.min(remain, left);
    console.log(`  · ${r.d} ${r.invoice_no}  ${put.toLocaleString()}원${put < remain ? ` (부분 — 장부 잔액 ${(remain - put).toLocaleString()}원)` : ""}`);
    if (APPLY) {
      await db.execute(sql`
        INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo)
        VALUES (${Number(r.id)}, ${put}, '계좌이체', '2026-08-31',
                '통장 출금 5,952,138 대조 — 사장님 확인 8월분 (2026-08-31)')
      `);
    }
    left -= put;
  }
  console.log(`남은 배분액: ${left.toLocaleString()}원 (0이어야 함)`);
  const [t] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE(pp.paid,0)),0)::bigint s FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id=pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total > COALESCE(pp.paid,0)
  `);
  console.log(`전체 「줄 돈」: ${Number(t.s).toLocaleString()}원`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => setTimeout(() => process.exit(0), 500));
