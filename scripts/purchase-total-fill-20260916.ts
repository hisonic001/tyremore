/**
 * ⭐ 「총액만 0원」인 직접 매입 채우기 — 일회성 (2026-09-16 사장님 승인 "(가) 9건 채워줘")
 *
 *   품목에는 금액이 있는데 장부 머리(subtotal·vat·total)만 0 인 매입이 9건 있었다.
 *   미지급은 `purchase_invoice.total` 로 세므로 그 매입들이 「갚을 돈 0」으로 보였다.
 *
 * 🔴 계산은 앱 정본 `recalcInvoiceTotals`(lib/invoice.ts) 그대로 — 품목 합 + 부가세 10%.
 *    새 식을 만들지 않는다.
 * 🔴 품목 금액이 아예 없는 매입(24건)은 **건드리지 않는다** — 금액을 모르는 것은 비워 두는 게 맞다.
 *
 *   npx tsx --env-file=.env.local scripts/purchase-total-fill-20260916.ts [--go]
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { recalcInvoiceTotals } from "../src/lib/invoice";
import { logActivity } from "../src/lib/fin-activity";

const GO = process.argv.includes("--go");
const won = (n: number) => n.toLocaleString("ko-KR");

async function main() {
  console.log(GO ? "▶ 반영합니다" : "▶ 미리보기 (--go 를 붙이면 반영)");
  const rows = await db.execute<{ id: number; supplier: string; issued_at: string; qty: number; item_sum: string }>(sql`
    SELECT pi.id, pi.supplier, pi.issued_at, COALESCE(pi.total_qty, 0) qty,
           (SELECT SUM(i.supply_amount)::bigint FROM purchase_invoice_item i WHERE i.invoice_id = pi.id) item_sum
    FROM purchase_invoice pi
    WHERE pi.status <> '취소' AND (pi.total IS NULL OR pi.total = 0)
      AND (SELECT SUM(i.supply_amount) FROM purchase_invoice_item i WHERE i.invoice_id = pi.id) > 0
    ORDER BY pi.issued_at`);
  let sum = 0;
  for (const r of rows) {
    const s = Number(r.item_sum);
    const total = Math.round(s * 1.1);

    /* 🔴 유일이엔티(#348)만 품목 단가가 **부가세 포함**으로 적혀 있다 —
       8/31 계산서가 공급 637,000 + 부가세 63,700 = 700,700 이라 품목합이 곧 총액이다.
       나머지(금호·미쉐린·블랙서클)는 품목이 공급가라 ×1.1 이 맞다(정상 매입 표본으로 확인). */
    const vatIncluded = Number(r.id) === 348;
    const realTotal = vatIncluded ? s : total;
    sum += realTotal;
    console.log(
      `  #${r.id} ${r.issued_at} ${r.supplier.padEnd(10)} ${r.qty}개 · 품목합 ${won(s).padStart(10)} → 총액 ${won(realTotal)}` +
        (vatIncluded ? "  (품목이 부가세 포함 — 계산서와 같은 금액)" : ""),
    );
    if (!GO) continue;
    if (vatIncluded) {
      await db.execute(sql`
        UPDATE purchase_invoice SET subtotal = ${Math.round(s / 1.1)}, vat = ${s - Math.round(s / 1.1)}, total = ${s}, updated_at = now()
        WHERE id = ${r.id}`);
    } else await recalcInvoiceTotals(Number(r.id));
    await logActivity({
      ym: r.issued_at.slice(0, 7), actor: null, how: "사람", verb: "수정",
      target: { table: "purchase_invoice", id: Number(r.id) }, amount: total,
      label: `수정: ${r.supplier} ${r.issued_at.slice(5)} 매입 총액 채움 → ${won(realTotal)} (품목 합 + 부가세)`,
      undo: null,
    });
  }
  console.log(`  ⇒ ${rows.length}건 · 합 ${won(sum)}원`);
  const [after] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id=pi.id),0)),0)::bigint s
    FROM purchase_invoice pi WHERE pi.status<>'취소'
      AND pi.total > COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id=pi.id),0)`);
  console.log(`  ⇒ 앱 미지급 합계 ${won(Number(after.s))}원`);
  process.exit(0);
}
main();
