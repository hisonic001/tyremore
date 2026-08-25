/**
 * 강남세차장 8/24 매입 이중 부가세 정정 (8월 감사 D1, 사장님 방침 2026-08-25)
 *
 *   인보이스 「직접-20260824-01」이 15,754,200원 — 세금계산서(정본)는 14,322,000원.
 *   원인: 단가를 부가세 **포함**으로 넣었는데 장부가 또 ×1.1 (정확히 계산서×1.1).
 *   사장님 방침 "계산서가 정본" — 아이템 단가를 ÷1.1 로 되돌리고 합계를 계산서에 맞춘다.
 *
 *   npx tsx scripts/fix-gangnam-20260824.ts   (멱등 — 이미 정정됐으면 건너뜀)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const TAX_SUPPLY = 13_020_000;
const TAX_VAT = 1_302_000;
const TAX_TOTAL = 14_322_000;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [inv] = await sql<{ id: number; total: number }[]>`
      SELECT id, total FROM purchase_invoice WHERE invoice_no = '직접-20260824-01'`;
    if (!inv) {
      console.log("장부를 찾을 수 없습니다 — 건너뜀");
      return;
    }
    if (Number(inv.total) === TAX_TOTAL) {
      console.log("이미 정정돼 있습니다 (14,322,000원) — 건너뜀");
      return;
    }
    if (Number(inv.total) !== 15_754_200) {
      console.log(`예상과 다른 총액 ${Number(inv.total).toLocaleString()}원 — 안전을 위해 건너뜀`);
      return;
    }
    await sql.begin(async (tx) => {
      // 아이템 단가·공급가를 ÷1.1 (부가세 별도 단가로 복원)
      await tx`
        UPDATE purchase_invoice_item
        SET unit_cost = round(unit_cost / 1.1)::int,
            supply_amount = round(unit_cost / 1.1)::int * qty
        WHERE invoice_id = ${inv.id} AND unit_cost IS NOT NULL`;
      // 헤더는 세금계산서 정본 값으로 고정 (아이템 합의 반올림 오차와 무관하게)
      await tx`
        UPDATE purchase_invoice
        SET subtotal = ${TAX_SUPPLY}, vat = ${TAX_VAT}, total = ${TAX_TOTAL}, updated_at = now()
        WHERE id = ${inv.id}`;
    });
    const [chk] = await sql<{ items: string; total: number }[]>`
      SELECT COALESCE(SUM(supply_amount), 0)::bigint items,
             (SELECT total FROM purchase_invoice WHERE id = ${inv.id}) total
      FROM purchase_invoice_item WHERE invoice_id = ${inv.id}`;
    console.log(
      `✅ 정정: 총액 15,754,200 → ${Number(chk.total).toLocaleString()}원 ` +
        `(아이템 공급가 합 ${Number(chk.items).toLocaleString()} — 계산서 공급가 ${TAX_SUPPLY.toLocaleString()}와 반올림 차이는 정상)`,
    );
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
