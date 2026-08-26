/**
 * 상대·품목 규칙 재적용 (2025 감사 F8, 2026-08-26)
 *
 *   과거분 되살리기(revive-all-past.ts)가 636건을 전부 '미대조'로 되돌리면서, 그 전에 사장님이
 *   정해 둔 경비·무시 규칙(tax_party_rule)·품목 규칙(tax_item_rule)이 2025 계산서에는 안 붙었다
 *   → 네이버(카드 결제라 통장 줄이 없음)·세무법인·SKT·한전이 2025 매입 목록에 계속 남았다.
 *   열린(미대조·제안) 계산서 전 기간에 규칙을 다시 적용한다. 업로드 시 자동 정리와 같은 식.
 *
 *   npx tsx scripts/reapply-tax-rules-20260826.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const norm = (s: string | null | undefined) => String(s ?? "").replace(/㈜|\(주\)|주식회사|\s/g, "").toLowerCase();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const party = await sql`
      UPDATE tax_invoice t SET recon_status = '무시', recon_reason = r.kind
      FROM tax_party_rule r
      WHERE t.is_active AND t.recon_status IN ('미대조', '제안')
        AND r.biz_no = t.counterparty_biz_no AND r.kind IN ('경비', '무시')
      RETURNING t.id, t.counterparty_name, t.write_date, r.kind`;
    const byName = new Map<string, number>();
    for (const p of party) byName.set(`${p.counterparty_name} (${p.kind})`, (byName.get(`${p.counterparty_name} (${p.kind})`) ?? 0) + 1);
    console.log(`① 상대 규칙 재적용 ${party.length}건`);
    for (const [k, n] of byName) console.log(`   - ${k}: ${n}건`);

    const itemRules = await sql<{ biz_no: string; item_key: string; kind: string }[]>`
      SELECT biz_no, item_key, kind FROM tax_item_rule LIMIT 2000`;
    const rmap = new Map(itemRules.map((r) => [`${r.biz_no}|${r.item_key}`, r.kind]));
    const open = await sql<{ id: number; counterparty_biz_no: string; counterparty_name: string; item_summary: string | null }[]>`
      SELECT id, counterparty_biz_no, counterparty_name, item_summary FROM tax_invoice
      WHERE is_active AND recon_status IN ('미대조', '제안') LIMIT 5000`;
    let itemN = 0;
    for (const row of open) {
      const k = rmap.get(`${row.counterparty_biz_no}|${norm(row.item_summary)}`);
      if (!k) continue;
      await sql`UPDATE tax_invoice SET recon_status = '무시', recon_reason = ${k} WHERE id = ${row.id}`;
      itemN++;
      console.log(`   - 품목 규칙: ${row.counterparty_name} · ${row.item_summary} → ${k}`);
    }
    console.log(`② 품목 규칙 재적용 ${itemN}건`);
    console.log(`✅ 완료 — 규칙 취소(✕)로 언제든 전 기간 되살릴 수 있습니다`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
