/**
 * ERP 3단계 — 카드 매출 표 (2026-08-24)
 *   🔴 여신금융협회 실파일이 건별이 아니라 **합계**다 (실측):
 *     card_day     「일별 승인내역」 — 날짜별 승인·취소 합계
 *     card_deposit 「월별 입금내역 세부」 — 월·카드사별 매출/입금 합계 (수수료 산출)
 *   npx tsx scripts/add-card-sales.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS card_day (
        id           bigserial PRIMARY KEY,
        day          date NOT NULL UNIQUE,     -- 재업로드는 그 날 값을 덮어쓴다 (최신이 정답)
        total_amount integer NOT NULL,         -- 거래합계 (승인+취소)
        total_cnt    integer NOT NULL DEFAULT 0,
        approved_amount integer NOT NULL DEFAULT 0,
        approved_cnt integer NOT NULL DEFAULT 0,
        cancelled_amount integer NOT NULL DEFAULT 0,  -- 파일 그대로 (음수)
        cancelled_cnt integer NOT NULL DEFAULT 0,
        is_active    boolean NOT NULL DEFAULT true,
        upload_id    bigint REFERENCES fin_upload(id),
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS card_deposit (
        id           bigserial PRIMARY KEY,
        month        text NOT NULL,            -- 'YYYY-MM'
        card_co      text NOT NULL,            -- 카드사 원문
        sale_cnt     integer NOT NULL DEFAULT 0,
        sale_amount  integer NOT NULL,
        vat_agency   integer NOT NULL DEFAULT 0,  -- 부가세 대리납부
        deposit_amount integer NOT NULL,       -- 실입금 (수수료 = 매출 - 대리납부 - 입금)
        is_active    boolean NOT NULL DEFAULT true,
        upload_id    bigint REFERENCES fin_upload(id),
        created_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (month, card_co)
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_card_day_day ON card_day (day) WHERE is_active`;
    console.log("✅ card_day · card_deposit 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
