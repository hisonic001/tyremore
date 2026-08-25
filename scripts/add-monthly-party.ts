/**
 * 월정산 거래처 유형 (사장님 승인 2026-08-25)
 *
 *   미쉐린처럼 「월말 합계 계산서 + 수시 분할결제」를 쓰는 상대는 계산서 한 장과
 *   출금 한 건이 1:1로 대응하지 않는다 (실측: 계산서 42건 ↔ 출금 107건).
 *   세무적으로도 매칭은 요구되지 않으므로, 이런 상대는 **월 단위 잔액**으로 관리한다.
 *
 *   npx tsx scripts/add-monthly-party.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    // CHECK 제약에 '월정산' 추가 — 기존 제약을 떼고 다시 건다
    await sql`ALTER TABLE tax_party_rule DROP CONSTRAINT IF EXISTS tax_party_rule_kind_check`;
    await sql`
      ALTER TABLE tax_party_rule
      ADD CONSTRAINT tax_party_rule_kind_check
      CHECK (kind IN ('경비', '대행정산', '무시', '월정산'))`;
    console.log("✅ tax_party_rule.kind 에 '월정산' 추가됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
