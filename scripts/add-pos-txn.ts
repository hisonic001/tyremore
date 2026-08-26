/**
 * 카드매출 일마감 — 토스 포스 결제 건(pos_txn) · 일마감(pos_close) · recon_match kind '포스결제' (2026-08-26)
 *
 *   토스 포스 매출리포트「결제 상세내역」은 승인번호가 없어 여신협회 card_txn 과 섞지 않는다(같은 결제가
 *   두 번 잡힘). 건 식별 = 결제시각(초)+금액+매입사+상태.
 *
 *   npx tsx scripts/add-pos-txn.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS pos_txn (
        id          bigserial PRIMARY KEY,
        day         date NOT NULL,             -- 결제기준일자
        paid_at     timestamptz NOT NULL,      -- 결제시각 (KST)
        channel     text,
        order_no    text,
        method      text NOT NULL,             -- 카드·현금·QR결제·계좌이체·선불지급수단·기타
        card_co     text,
        amount      integer NOT NULL,          -- 취소는 음수
        vat         integer,
        is_cancel   boolean NOT NULL DEFAULT false,
        cancel_at   timestamptz,
        dedup_key   text NOT NULL UNIQUE,
        is_active   boolean NOT NULL DEFAULT true,
        upload_id   bigint REFERENCES fin_upload(id),
        created_at  timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pos_txn_day ON pos_txn (day) WHERE is_active`;
    await sql`
      CREATE TABLE IF NOT EXISTS pos_close (
        day             date PRIMARY KEY,
        closed_at       timestamptz NOT NULL DEFAULT now(),
        closed_by       bigint,
        pos_card_total  integer NOT NULL DEFAULT 0,
        app_card_total  integer NOT NULL DEFAULT 0,
        matched_n       integer NOT NULL DEFAULT 0,
        notes           jsonb NOT NULL DEFAULT '[]'::jsonb
      )`;
    // 사유(설명)는 마감 전에도 남는다 — 마감과 별도 표
    await sql`
      CREATE TABLE IF NOT EXISTS pos_note (
        id          bigserial PRIMARY KEY,
        day         date NOT NULL,
        kind        text NOT NULL,             -- 'pos_only' | 'app_only'
        ref         text NOT NULL,             -- 'pos:ID' | 'quote:ID' | 'qp:ID' | 'rp:ID'
        reason      text NOT NULL,             -- 단말기 누락 · 앱 미등록 · 취소 · 다른 날 · 기타
        memo        text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (ref)
      )`;
    // fin_upload.source 는 CHECK 로 잠겨 있다 — 새 원천 '토스포스' 추가
    await sql`ALTER TABLE fin_upload DROP CONSTRAINT IF EXISTS fin_upload_source_check`;
    await sql`ALTER TABLE fin_upload ADD CONSTRAINT fin_upload_source_check
      CHECK (source IN ('홈택스매출','홈택스매입','법인카드','통장','카드매출승인','카드매출입금','토스포스'))`;
    // 🔴 kind CHECK 가 둘이었다 — 스키마 원본(recon_match_kind_check)과 스크립트 추가분(recon_match_kind). 하나로.
    await sql`ALTER TABLE recon_match DROP CONSTRAINT IF EXISTS recon_match_kind_check`;
    await sql`ALTER TABLE recon_match DROP CONSTRAINT IF EXISTS recon_match_kind`;
    await sql`ALTER TABLE recon_match ADD CONSTRAINT recon_match_kind
      CHECK (kind IN ('매입계산서','매출계산서','이체입금','카드정산입금','카드승인','매입지급','포스결제'))`;
    console.log("✅ pos_txn · pos_close · pos_note · recon_match kind '포스결제' 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
