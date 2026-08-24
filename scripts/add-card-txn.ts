/**
 * 카드 매출 건별 승인 (여신협회 「기간별 승인내역 - 세부내역」, 2026-08-25)
 *
 *   일별 합계(card_day)만 있던 것을 건별로 — 차이 난 날 어떤 승인이 앱에 없는지
 *   바로 짚을 수 있다. 일별 합계는 세부에서 집계해 card_day 에도 같이 얹는다.
 *
 *   npx tsx scripts/add-card-txn.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS card_txn (
        id           bigserial PRIMARY KEY,
        approved_at  timestamptz NOT NULL,   -- 거래일자+시간 (KST)
        card_co      text NOT NULL,
        card_no_masked text,
        approval_no  text NOT NULL,
        amount       integer NOT NULL,       -- 취소는 음수 (파일 그대로)
        is_cancel    boolean NOT NULL DEFAULT false,
        installment  text,
        dedup_key    text NOT NULL UNIQUE,
        is_active    boolean NOT NULL DEFAULT true,
        upload_id    bigint REFERENCES fin_upload(id),
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_card_txn_at ON card_txn (approved_at) WHERE is_active`;
    console.log("✅ card_txn 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
