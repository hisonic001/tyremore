/**
 * ⭐ MARS 파이프라인 상태의 DB화 (2026-08-18 — 근본 개선 단계2)
 *
 * 판매 1건의 MARS 입력은 8단계(고객확인→…→점검)인데 지금까지 DB 흔적은
 * mars_status 하나뿐이었다 — 중간에 죽으면 어디까지 갔는지 아무도 모르고,
 * 재시도가 항상 처음부터 새 주문을 만들어 MARS 에 고아 초안이 쌓였다
 * (실측: 한 건이 2회 실패로 초안 2개).
 *
 * · quote.mars_order_no — 만들다 만/만든 매출 주문(SO) 번호. 재시도가 이어쓸
 *   초안이 있는지를 대기열 질의 한 줄로 안다. (mars_ref_no 는 송장(SI) 전용으로)
 * · mars_attempt — 시도별 단계 이력 (진단용).
 *
 * 실행: npx tsx scripts/add-mars-attempt.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS mars_order_no text`;
    await sql`CREATE TABLE IF NOT EXISTS mars_attempt (
      id bigserial PRIMARY KEY,
      quote_id bigint NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
      mars_run_id bigint,
      stage text NOT NULL DEFAULT '시작',
      order_no text,
      invoice_no text,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mars_attempt_quote ON mars_attempt (quote_id, id DESC)`;
    console.log("✅ quote.mars_order_no + mars_attempt 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
