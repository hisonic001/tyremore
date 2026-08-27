/**
 * 연간 실행 되돌리기 — run-year.ts 가 만든 자국(method '자동'·'조정', since 이후)과 월정산 확인을 원상복구.
 *   npx tsx scripts/revert-year-run.ts <sinceISO> [year]
 *   (자동 분류 카테고리는 규칙 기반·결정적이라 되돌리지 않는다 — 화면에서 「해제」로 개별 되돌리기)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const since = process.argv[2];
  const year = process.argv[3] ?? "2025";
  if (!since) throw new Error("since ISO 시각이 필요합니다 (run-<year>.json 의 startedAt)");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const gone = await sql<{ src_table: string; src_id: number; ref_table: string; ref_id: number }[]>`
      DELETE FROM recon_match WHERE method IN ('자동', '조정') AND confirmed_at >= ${since}::timestamptz
        AND kind IN ('매입계산서', '매출계산서', '이체입금')
      RETURNING src_table, src_id, ref_table, ref_id`;
    const cashIds = new Set<number>();
    const taxIds = new Set<number>();
    for (const g of gone) {
      if (g.ref_table === "cash_txn") cashIds.add(Number(g.ref_id));
      if (g.src_table === "cash_txn") cashIds.add(Number(g.src_id));
      if (g.src_table === "tax_invoice") taxIds.add(Number(g.src_id));
    }
    for (const id of cashIds) {
      await sql`
        UPDATE cash_txn c SET recon_status = CASE WHEN EXISTS (SELECT 1 FROM recon_match m WHERE m.status='확정' AND ((m.ref_table='cash_txn' AND m.ref_id=c.id) OR (m.src_table='cash_txn' AND m.src_id=c.id))) THEN '제안' ELSE '미대조' END,
          category = CASE WHEN c.category = '매입대금' AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.status='확정' AND ((m.ref_table='cash_txn' AND m.ref_id=c.id AND m.kind='매입계산서') OR (m.src_table='cash_txn' AND m.src_id=c.id AND m.kind='매입지급'))) THEN NULL ELSE c.category END
        WHERE c.id = ${id} AND c.recon_status <> '무시'`;
    }
    for (const id of taxIds) {
      await sql`
        UPDATE tax_invoice t SET recon_status = '미대조', recon_reason = NULL
        WHERE t.id = ${id} AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.src_table='tax_invoice' AND m.src_id=t.id AND m.status='확정')`;
    }
    const mon = await sql`
      UPDATE tax_invoice SET recon_status = '미대조', recon_reason = NULL
      WHERE is_active AND recon_reason = '월정산' AND to_char(write_date, 'YYYY') = ${year}
      RETURNING id`;
    console.log(`✅ 자국 ${gone.length}건 삭제 · 통장 ${cashIds.size}줄 복원 · 계산서 ${taxIds.size}장 복원 · 월정산 ${mon.length}장 되돌림`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
