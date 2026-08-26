/**
 * MAXRUN 입금 정정 (사장님 지적 2026-08-26 — "맥스런은 카드정산이 아님")
 *
 *   「[FB자금] MAXRUN」 이 카드사 정산 적요 패턴(FB자금)에 걸려 '카드정산'으로 접혔다.
 *   실제는 온라인몰 맥스런의 판매 대금 정산 — 맥스런 매출 계산서(1,138,332 · 307,742 …)와 짝이다.
 *   ①카드정산 분류·확정을 풀어 정리 목록으로 되돌린다(연결 없는 것만)
 *   ②별명 「maxrun → 맥스런(5568600899) 정산입금」을 심어 ★로 바로 알아보게 한다.
 *   패턴 자체는 expense-cats.CARD_SETTLE_PATTERN_SQL 에서 MAXRUN 제외로 고쳤다.
 *
 *   npx tsx scripts/fix-maxrun-20260826.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql`
      UPDATE cash_txn c SET category = NULL, recon_status = '미대조'
      WHERE c.description ILIKE '%MAXRUN%' AND c.category = '카드정산'
        AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE (m.ref_table = 'cash_txn' AND m.ref_id = c.id)
                                                       OR (m.src_table = 'cash_txn' AND m.src_id = c.id))
      RETURNING id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d, in_amount`;
    console.log(`① MAXRUN 카드정산 해제 ${rows.length}건:`, rows.map((r) => `${r.d} ${Number(r.in_amount).toLocaleString()}`).join(" · "));
    await sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES ('maxrun@5568600899', 'MAXRUN', 'T:5568600899', '정산입금 (주)맥스런')
      ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key, party_label = EXCLUDED.party_label, updated_at = now()`;
    console.log("② 별명 maxrun → 맥스런 정산입금 ✓");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
