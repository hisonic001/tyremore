/**
 * ERP 2단계 — 대조 연결 표 (2026-08-24)
 *   외부 자료 한 건 ↔ 앱 기록 여러 건 (월합계 세금계산서 대비 1:N).
 *   ref_table/ref_id 는 FK 없는 범용 참조 (import_issue 전례) — 확정 액션이 코드로 검증한다.
 *   npx tsx scripts/add-recon-match.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS recon_match (
        id          bigserial PRIMARY KEY,
        kind        text NOT NULL CHECK (kind IN ('매입계산서','매출계산서','이체입금','카드정산입금','카드승인')),
        src_table   text NOT NULL,
        src_id      bigint NOT NULL,
        ref_table   text NOT NULL,
        ref_id      bigint NOT NULL,
        amount      integer NOT NULL,
        status      text NOT NULL DEFAULT '제안' CHECK (status IN ('제안','확정')),
        confidence  text CHECK (confidence IN ('높음','중간','낮음')),
        method      text NOT NULL DEFAULT '자동' CHECK (method IN ('자동','수동')),
        confirmed_by bigint REFERENCES app_user(id),
        confirmed_at timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_recon_src ON recon_match (src_table, src_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_recon_ref ON recon_match (ref_table, ref_id)`;
    console.log("✅ recon_match 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
