/**
 * ⭐ 예약거래 칸 (사장님 요청 2026-09-01)
 *
 *   선금 받고 나중에 시공하는 예약 — 돈은 받은 날 그대로, 재고·MARS 만 시공까지 미룬다.
 *   · quote.reservation_status  NULL(일반) | '예약중' | '시공완료'
 *   · quote.fulfilled_on        시공한 날 (매출 날 work_date 는 안 건드린다)
 *   · quote_payment.paid_on     분할 결제 받은 날 — 비면 지금처럼 work_date 로 해석
 *                               (예약금 8/18 · 잔금 8/29 꼴이 판매 한 건에 담기게)
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-reservation.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS reservation_status text`);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE quote ADD CONSTRAINT quote_reservation_status_check
        CHECK (reservation_status IN ('예약중','시공완료'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  await db.execute(sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS fulfilled_on date`);
  await db.execute(sql`ALTER TABLE quote_payment ADD COLUMN IF NOT EXISTS paid_on date`);
  // 예약 홀드 조회용 — 예약중 건만 부분 인덱스
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_quote_reserved ON quote (reservation_status)
    WHERE reservation_status = '예약중'
  `);
  const [chk] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM information_schema.columns
    WHERE (table_name='quote' AND column_name IN ('reservation_status','fulfilled_on'))
       OR (table_name='quote_payment' AND column_name='paid_on')
  `);
  console.log(`✅ 예약 칸 준비 완료 (${chk.n}/3)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
