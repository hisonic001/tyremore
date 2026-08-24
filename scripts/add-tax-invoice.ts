/**
 * ERP 2단계 — 전자세금계산서 표 + 거래처 사업자번호 학습 칸 (2026-08-24)
 *   npx tsx scripts/add-tax-invoice.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS tax_invoice (
        id           bigserial PRIMARY KEY,
        direction    text NOT NULL CHECK (direction IN ('매출','매입')),
        approval_no  text NOT NULL UNIQUE,   -- 국세청 승인번호 — 재업로드 중복 방지의 전부
        write_date   date NOT NULL,          -- 작성일자
        issue_date   date,                   -- 발급일자
        counterparty_biz_no text NOT NULL,   -- 상대방 사업자번호 (숫자만; 매입=공급자, 매출=공급받는자)
        counterparty_name   text NOT NULL,   -- 상호 원문 보존
        supply_amount integer NOT NULL,
        vat          integer NOT NULL DEFAULT 0,
        total        integer NOT NULL,
        item_summary text,                   -- 품목명
        recon_status text NOT NULL DEFAULT '미대조'
          CHECK (recon_status IN ('미대조','제안','확정','무시')),
        is_active    boolean NOT NULL DEFAULT true,
        upload_id    bigint REFERENCES fin_upload(id),
        memo         text,
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tax_invoice_open ON tax_invoice (direction, write_date)
              WHERE recon_status IN ('미대조','제안') AND is_active`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tax_invoice_biz ON tax_invoice (counterparty_biz_no)`;

    // 거래처 사업자번호 — 첫 확정 때 "기억할까요?"로 학습한다 (supplier_item_code 철학)
    await sql`ALTER TABLE supplier ADD COLUMN IF NOT EXISTS biz_no text`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_biz_no ON supplier (biz_no) WHERE biz_no IS NOT NULL`;

    console.log("✅ tax_invoice + supplier.biz_no 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
