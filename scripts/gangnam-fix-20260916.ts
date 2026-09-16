/**
 * ⭐ 강남세차장 매입 금액 채우기 + 지급 맞추기 — 일회성 (2026-09-16 사장님 확인)
 *
 *   ① 9/2 매입(iON ST AS SUV 235/55R19 50본) 총액이 비어 있었다 → 계산서대로 5,956,500원
 *      (품목엔 이미 본당 108,300 · 공급가 5,415,000 이 들어 있었다. 헤더만 0이었다.)
 *   ② 8/12 매입(Ventus air S H472 245/45R19 1본) 금액이 비어 있었다 → 사장님 확인:
 *      8/12 계산서 173,030원이 이 건 → 공급 157,300 + 부가세 15,730
 *   ③ 8/13 송금 173,030 → 그 매입에 지급 (딱 떨어진다)
 *   ④ 8/3 송금 352,176 → 사장님: "과거 매입내역" → 접는다
 *
 *   npx tsx --env-file=.env.local scripts/gangnam-fix-20260916.ts        (미리보기)
 *   npx tsx --env-file=.env.local scripts/gangnam-fix-20260916.ts --go   (반영)
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { logActivity } from "../src/lib/fin-activity";

const GO = process.argv.includes("--go");
const won = (n: number) => n.toLocaleString("ko-KR");

async function show(label: string) {
  const rows = await db.execute<{ id: number; issued_at: string; total: number; paid: string; remain: string }>(sql`
    SELECT pi.id, pi.issued_at, pi.total,
           COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id = pi.id), 0)::bigint paid,
           (pi.total - COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id = pi.id), 0))::bigint remain
    FROM purchase_invoice pi WHERE pi.supplier ILIKE '%강남세차장%' AND pi.status <> '취소' ORDER BY pi.issued_at`);
  console.log(`\n[${label}]`);
  for (const r of rows) console.log(`  ${r.issued_at} 매입 ${won(Number(r.total))} · 준 돈 ${won(Number(r.paid))} · 남은 ${won(Number(r.remain))}`);
  console.log(`  미지급 합 ${won(rows.reduce((s, r) => s + Number(r.remain), 0))}`);
}

async function main() {
  console.log(GO ? "▶ 반영합니다" : "▶ 미리보기 (--go 를 붙이면 반영)");
  await show("지금");

  if (GO) {
    /* ① 9/2 — 품목 금액은 그대로, 헤더만 계산서대로 */
    await db.execute(sql`
      UPDATE purchase_invoice SET subtotal = 5415000, vat = 541500, total = 5956500, updated_at = now()
      WHERE id = 409 AND total = 0`);
    await logActivity({
      ym: "2026-09", actor: null, how: "사람", verb: "수정",
      target: { table: "purchase_invoice", id: 409 }, amount: 5956500,
      label: "수정: 강남세차장 9/2 매입(50본) 금액 채움 → 5,956,500 (계산서대로)", undo: null });

    /* ② 8/12 — 품목·헤더 함께 (1본) */
    await db.execute(sql`UPDATE purchase_invoice_item SET supply_amount = 157300, unit_cost = 157300 WHERE invoice_id = 303`);
    await db.execute(sql`
      UPDATE purchase_invoice SET subtotal = 157300, vat = 15730, total = 173030, updated_at = now()
      WHERE id = 303 AND total = 0`);
    await logActivity({
      ym: "2026-08", actor: null, how: "사람", verb: "수정",
      target: { table: "purchase_invoice", id: 303 }, amount: 173030,
      label: "수정: 강남세차장 8/12 매입(1본) 금액 채움 → 173,030 (8/12 계산서)", undo: null });

    /* ③ 8/13 송금 173,030 → 8/12 매입 */
    await db.execute(sql`
      INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
      VALUES (303, 173030, '계좌이체', '2026-08-13', '통장 출금 연결 (밀린 지급 맞추기 2026-09-16)', NULL)`);
    await db.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_at)
      VALUES ('매입지급', 'cash_txn', 5105, 'purchase_invoice', 303, 173030, '확정', '수동', now())`);
    await db.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = 5105`);
    await logActivity({
      ym: "2026-08", actor: null, how: "사람", verb: "지급",
      target: { table: "cash_txn", id: 5105 }, amount: 173030,
      label: "지급: 08-13 173,030 → 강릉 강남세차장카센터 (8/12 매입)",
      undo: { kind: "pay", args: { cashTxnId: 5105 } } });

    /* ④ 8/3 352,176 — 과거 매입내역이라 접는다 */
    await db.execute(sql`
      UPDATE cash_txn SET recon_status = '무시',
        memo = COALESCE(memo || ' · ', '') || '지급 잡기에서 접음 (과거 매입내역 — 사장님 확인 2026-09-16)'
      WHERE id = 5133`);
    await logActivity({
      ym: "2026-08", actor: null, how: "사람", verb: "제외",
      target: { table: "cash_txn", id: 5133 }, amount: 352176,
      label: "제외: 출금 08-03 352,176 최선종(강남세차장) 접음 (과거 매입내역)",
      undo: { kind: "skip", args: { cashTxnId: 5133 } } });
  } else {
    console.log("\n  ① 9/2 매입 0원 → 5,956,500 (계산서대로)");
    console.log("  ② 8/12 매입 0원 → 173,030 (8/12 계산서)");
    console.log("  ③ 8/13 송금 173,030 → 8/12 매입에 지급");
    console.log("  ④ 8/3 송금 352,176 접기 (과거 매입내역)");
  }

  await show(GO ? "고친 뒤" : "반영하면 이렇게 됩니다(미리보기라 위와 같음)");
  process.exit(0);
}
main();
