/**
 * ⭐ 렌트카 거래처 월 정산 표 (사장님 요청 2026-09-01)
 *
 *   "월초에 거래처가 검토 후 반려/승인/금액조정을 보내줌 → 앱에서 달라진 내역을
 *    전부 재조정(가장 불편)" — 그 재조정을 회차·판정·한꺼번에 적용으로 바꾼다.
 *
 *   · settlement_run       거래처×월 1건 (수기 「청구·입금 관리대장」의 한 줄)
 *   · settlement_line      그 달 외상 판매 스냅샷 + 판정 (billed_amount 가 원 청구액 보관처)
 *   · settlement_line_item 조정·부분반려로 고치기 **전** 품목 줄 스냅샷
 *   · supplier.vat_mode    '포함'(기본) / '별도'(AJ — 앱엔 부가세 별도 금액, 청구는 ×1.1)
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-settlement.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`
    ALTER TABLE supplier ADD COLUMN IF NOT EXISTS vat_mode text NOT NULL DEFAULT '포함'
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE supplier ADD CONSTRAINT supplier_vat_mode_check CHECK (vat_mode IN ('포함','별도'));
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);
  // AJ 는 실측상 부가세 별도 금액으로 등록해 오셨다 (8월 수리비 엑셀 대조)
  await db.execute(sql`
    UPDATE supplier SET vat_mode = '별도' WHERE name = 'AJ렌트카' AND vat_mode = '포함'
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settlement_run (
      id bigserial PRIMARY KEY,
      supplier_name text NOT NULL,
      ym text NOT NULL,
      status text NOT NULL DEFAULT '작성중'
        CHECK (status IN ('작성중','회신반영중','적용완료','입금완료')),
      invoiced_amount integer,
      invoice_exported_at timestamptz,
      agreed_amount integer,
      applied_at timestamptz,
      deposited_on date,
      deposited_amount integer,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_run ON settlement_run (supplier_name, ym)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settlement_line (
      id bigserial PRIMARY KEY,
      run_id bigint NOT NULL REFERENCES settlement_run(id) ON DELETE CASCADE,
      quote_id bigint NOT NULL REFERENCES quote(id),
      billed_amount integer NOT NULL,
      decision text NOT NULL DEFAULT '대기'
        CHECK (decision IN ('대기','승인','조정','부분반려','반려','보류')),
      agreed_amount integer,
      reply_memo text,
      matched_by text,
      applied_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_line ON settlement_line (run_id, quote_id)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS settlement_line_item (
      id bigserial PRIMARY KEY,
      line_id bigint NOT NULL REFERENCES settlement_line(id) ON DELETE CASCADE,
      quote_item_id bigint,
      description text NOT NULL,
      qty integer NOT NULL,
      original_price integer NOT NULL,
      action text NOT NULL CHECK (action IN ('반려','조정')),
      agreed_price integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const [chk] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM information_schema.tables
    WHERE table_name IN ('settlement_run','settlement_line','settlement_line_item')
  `);
  console.log(`✅ 정산 표 준비 완료 (표 ${chk.n}/3 + supplier.vat_mode)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
