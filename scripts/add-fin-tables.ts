/**
 * ERP 1단계 — 자금 자료 표 (2026-08-24 사장님 승인, 계획: noble-squishing-meteor.md)
 *
 *   fin_upload  업로드 배치 — 원본(CSV) 보존 + 재파싱 + 배치 단위 취소
 *   cash_txn    자금 움직임 — 법인카드 사용(지출) + 통장 입출금. 「실제 돈이 움직인 기록」만
 *
 *   npx tsx scripts/add-fin-tables.ts   (멱등 — 몇 번 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS fin_upload (
        id           bigserial PRIMARY KEY,
        source       text NOT NULL CHECK (source IN ('홈택스매출','홈택스매입','법인카드','통장','카드매출승인','카드매출입금')),
        account_label text,          -- '국민법인카드' · '신한주거래' (법인카드·통장만)
        file_name    text NOT NULL,
        raw_text     text NOT NULL,  -- 시트를 CSV 로 보존 — 파서를 고쳐 다시 읽을 수 있게 (purchase_invoice.raw_text 전례)
        row_count    int NOT NULL DEFAULT 0,
        new_count    int NOT NULL DEFAULT 0,
        dup_count    int NOT NULL DEFAULT 0,
        period_from  date,
        period_to    date,
        status       text NOT NULL DEFAULT '반영' CHECK (status IN ('반영','취소')),
        created_by   bigint REFERENCES app_user(id),
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS cash_txn (
        id           bigserial PRIMARY KEY,
        source       text NOT NULL CHECK (source IN ('법인카드','통장')),
        account_label text NOT NULL,
        occurred_at  timestamptz NOT NULL,
        description  text NOT NULL,               -- 가맹점명 / 적요·내용 원문 보존
        in_amount    integer NOT NULL DEFAULT 0,  -- 통장 입금 (법인카드는 항상 0)
        out_amount   integer NOT NULL DEFAULT 0,  -- 통장 출금 / 카드 이용금액 (취소는 음수)
        balance      bigint,                      -- 통장만. 거래 후 잔액 — 중복 방지 키의 핵심
        approval_no  text,                        -- 법인카드 승인번호
        biz_no       text,                        -- 법인카드 가맹점 사업자번호 (KB 확인서에 있음 — 매입 대조용)
        installment  text,                        -- 할부
        branch       text,                        -- 거래점 (통장)
        payer_code   text,                        -- 통장 입금인코드 (카드 정산 식별용)
        dedup_key    text NOT NULL UNIQUE,        -- 파서가 만든 중복 방지 열쇠
        category     text,                        -- 사장님이 붙이는 경비 분류 (나중 단계, NULL 허용)
        recon_status text NOT NULL DEFAULT '미대조'
          CHECK (recon_status IN ('미대조','제안','확정','무시')),
        is_active    boolean NOT NULL DEFAULT true, -- 배치 취소 시 false — 지우지 않는다
        upload_id    bigint REFERENCES fin_upload(id),
        memo         text,
        created_at   timestamptz NOT NULL DEFAULT now()
      )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_cash_txn_month ON cash_txn (source, occurred_at) WHERE is_active`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cash_txn_open  ON cash_txn (recon_status) WHERE recon_status IN ('미대조','제안') AND is_active`;

    console.log("✅ fin_upload · cash_txn 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
