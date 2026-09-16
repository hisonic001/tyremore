/**
 * ⭐ 스칼릿(배터리) 매입 금액 채우기 — 일회성 (2026-09-16 사장님 확인 "계산서 금액으로 총액만")
 *
 *   배터리 입고는 등록됐지만 금액이 0원이라 미지급에 안 잡혔다.
 *   · #404 (9/1 배터리 119개) ← 8/31 계산서 18,546,220 (공급 16,860,200 + 부가세 1,686,020)
 *   · #403 (9/1 델코 DF65 1개) ← 품목에 이미 있던 117,040 으로 헤더만 (총액 128,744)
 *   🔴 품목별 단가는 건드리지 않는다 — 원가·재고 셈이 바뀌지 않게 (사장님 선택).
 *
 *   npx tsx --env-file=.env.local scripts/scarlet-fill-20260916.ts [--go]
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { logActivity } from "../src/lib/fin-activity";

const GO = process.argv.includes("--go");
const won = (n: number) => n.toLocaleString("ko-KR");

const FIXES = [
  { id: 404, subtotal: 16860200, vat: 1686020, total: 18546220, why: "8/31 계산서 금액" },
  { id: 403, subtotal: 117040, vat: 11704, total: 128744, why: "품목 금액(117,040) 기준" },
];

async function main() {
  console.log(GO ? "▶ 반영합니다" : "▶ 미리보기 (--go 를 붙이면 반영)");
  for (const f of FIXES) {
    const [pi] = await db.execute<{ id: number; issued_at: string; total: number; total_qty: number }>(sql`
      SELECT id, issued_at, total, total_qty FROM purchase_invoice WHERE id = ${f.id} AND supplier ILIKE '%스칼릿%'`);
    if (!pi) { console.log(`  ⚠ #${f.id} 없음`); continue; }
    console.log(`  #${f.id} ${pi.issued_at} ${pi.total_qty}개 — ${won(Number(pi.total))} → ${won(f.total)} (${f.why})`);
    if (!GO || Number(pi.total) !== 0) continue;
    await db.execute(sql`
      UPDATE purchase_invoice SET subtotal = ${f.subtotal}, vat = ${f.vat}, total = ${f.total}, updated_at = now()
      WHERE id = ${f.id} AND total = 0`);
    await logActivity({
      ym: pi.issued_at.slice(0, 7), actor: null, how: "사람", verb: "수정",
      target: { table: "purchase_invoice", id: f.id }, amount: f.total,
      label: `수정: 스칼릿 ${pi.issued_at.slice(5)} 매입 금액 채움 → ${won(f.total)} (${f.why})`, undo: null });
  }
  const [after] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id=pi.id),0)),0)::bigint s
    FROM purchase_invoice pi WHERE pi.supplier ILIKE '%스칼릿%' AND pi.status <> '취소'`);
  console.log(`  ⇒ 스칼릿 미지급 ${won(Number(after.s))}원`);
  process.exit(0);
}
main();
