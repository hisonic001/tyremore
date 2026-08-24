/**
 * 세금계산서 대조 v2 (사장님 승인 2026-08-25 — "전반적으로 리빌딩")
 *
 *   실측: 미대조 692건 중 676건(98%)이 앱 도입(2026-08) 이전 = 대조 불가능한 과거분.
 *   ① tax_invoice.recon_reason — 무시에 사유를 남긴다 (과거분/경비/대행정산/입금연결…)
 *   ② tax_party_rule — 상대(사업자번호) 유형 사전: 한 번 지정하면 계속 자동
 *   ③ 과거분 백필 — 도입 전 미대조를 「무시/과거분」으로 (부가세 참고 합계는 유지)
 *
 *   npx tsx scripts/add-tax-recon-v2.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS recon_reason text`;
    await sql`
      CREATE TABLE IF NOT EXISTS tax_party_rule (
        id         bigserial PRIMARY KEY,
        biz_no     text NOT NULL UNIQUE,   -- 상대 사업자번호 (숫자만)
        name_raw   text NOT NULL,          -- 상호 원문 (표시용)
        kind       text NOT NULL CHECK (kind IN ('경비','대행정산','무시')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    const past = await sql`
      UPDATE tax_invoice SET recon_status = '무시', recon_reason = '과거분'
      WHERE is_active AND recon_status IN ('미대조', '제안') AND write_date < '2026-08-01'
      RETURNING id`;
    console.log(`✅ recon_reason·tax_party_rule 준비됨 — 과거분 백필 ${past.length}건`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
