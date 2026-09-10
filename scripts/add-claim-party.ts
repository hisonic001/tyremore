/**
 * ⭐ 본사청구 판매 — 청구처·사유 칸 (2026-09-10)
 *
 *   미쉐린 데미지 프리 쿠폰 무상 교체·OE 타이어 AS 는 손님 차에 시공하지만
 *   **돈은 본사가 준다**. 지금까지 앱 밖에 있어 재고도 안 빠지고 원가도 안
 *   잡혔고, 입금만 뒷마진에 넣으니 마진이 20만원쯤 부풀었다(사장님 지적).
 *
 * 🔴 왜 `supplier_name` 을 쓰지 않는가: 그 칸이 차 있으면 sale.ts 가 MARS 를
 *    「해당없음」으로 굳힌다. 데미지 교체는 소매 시공이라 **MARS 에 올려야
 *    한다**(사장님 확인 2026-09-10) — 그래서 청구처를 담을 칸을 따로 둔다.
 *    결제수단은 「외상」 그대로다 (미쉐린에게 받을 돈이 맞으므로).
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-claim-party.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS claim_party text`);
  await db.execute(sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS claim_kind text`);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE quote ADD CONSTRAINT quote_claim_kind_check
        CHECK (claim_kind IS NULL OR claim_kind IN ('데미지쿠폰', 'OE AS', '기타'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  // 외상 장부·청구 화면이 청구처로 묶을 때 쓰는 길
  await db.execute(sql`CREATE INDEX IF NOT EXISTS quote_claim_party_idx ON quote (claim_party) WHERE claim_party IS NOT NULL`);

  const [n] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM quote WHERE claim_party IS NOT NULL`);
  console.log(`quote.claim_party·claim_kind 준비됨 — 현재 본사청구 판매 ${n.n}건`);
  process.exit(0);
}
main();
