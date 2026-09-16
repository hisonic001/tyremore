/**
 * ⭐ 밀린 지급 대조 맞추기 — 일회성 (2026-09-16 사장님 승인)
 *
 *   D-40(계산서 대조와 지급 대조 분리) 이전에, 그때그때 낸 송금이 **매입계산서**와만
 *   짝지어져 미지급 장부를 못 줄인 것들을 손으로 맞춘다.
 *
 *   ① 제로 8/15 매입 — 부가세를 두 번 붙였다(844,000 + 84,400 = 928,400).
 *      사장님 확인: **844,000원이 맞다.** 품목 금액은 그대로 두고 헤더만 맞춘다.
 *   ② 제로 9/10 송금 844,000 → 그 매입에 지급 (미지급 0)
 *   ③ 나이스 오토파츠 미지급 251,058 — 사장님: "다 냈다".
 *      아직 지급으로 안 쓰인 송금을 **오래된 것부터** 붙여 0으로 만든다.
 *
 * 🔴 되돌리기: 「최근 한 일」에 건별로 남긴다(kind "pay" → undoPayFromWithdrawal).
 * 🔴 기본은 --dry (보기만). 실제 반영은 --go.
 *
 *   npx tsx --env-file=.env.local scripts/payable-catchup-20260916.ts        (미리보기)
 *   npx tsx --env-file=.env.local scripts/payable-catchup-20260916.ts --go   (반영)
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { logActivity } from "../src/lib/fin-activity";

const GO = process.argv.includes("--go");
const won = (n: number) => n.toLocaleString("ko-KR");

/** 지급으로 아직 안 쓰인 몫 */
const payUsed = (alias: string) => sql`
  COALESCE((SELECT SUM(m.amount)::bigint FROM recon_match m
    WHERE m.status = '확정' AND m.kind = '매입지급'
      AND m.src_table = 'cash_txn' AND m.src_id = ${sql.raw(alias)}.id), 0)`;

async function openInvoices(supplier: string) {
  return db.execute<{ id: number; invoice_no: string; issued_at: string; remain: string }>(sql`
    SELECT pi.id, pi.invoice_no, pi.issued_at,
           (pi.total - COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id = pi.id), 0))::bigint remain
    FROM purchase_invoice pi
    WHERE pi.status <> '취소' AND pi.supplier = ${supplier} AND pi.total > 0
      AND pi.total > COALESCE((SELECT SUM(amount)::int FROM purchase_payment p WHERE p.invoice_id = pi.id), 0)
    ORDER BY pi.issued_at, pi.id
  `);
}

async function withdrawals(ids: number[]) {
  return db.execute<{ id: number; d: string; description: string; left: string }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d, c.description,
           (c.out_amount - ${payUsed("c")})::bigint left
    FROM cash_txn c WHERE c.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY c.occurred_at
  `);
}

/** 한 거래처의 미지급을 주어진 송금들로 오래된 것부터 덮는다 */
async function settle(supplier: string, cashIds: number[]) {
  const invs = (await openInvoices(supplier)).map((i) => ({ ...i, remain: Number(i.remain) }));
  const outs = (await withdrawals(cashIds)).map((o) => ({ ...o, left: Number(o.left) }));
  console.log(`\n── ${supplier} ──`);
  console.log(`  미지급 ${won(invs.reduce((s, i) => s + i.remain, 0))}원 (${invs.length}장)`);
  for (const o of outs) console.log(`  송금 ${o.d} ${won(o.left)}원 남음 — ${o.description}`);

  for (const o of outs) {
    let left = o.left;
    const items: { invoiceId: number; no: string; amount: number }[] = [];
    for (const inv of invs) {
      if (left <= 0) break;
      if (inv.remain <= 0) continue;
      const amt = Math.min(left, inv.remain);
      items.push({ invoiceId: inv.id, no: inv.invoice_no, amount: amt });
      inv.remain -= amt;
      left -= amt;
    }
    if (items.length === 0) {
      console.log(`  · ${o.d} ${won(o.left)} → 붙일 매입 없음 (그대로 둠)`);
      continue;
    }
    const used = items.reduce((s, i) => s + i.amount, 0);
    console.log(`  · ${o.d} 송금 ${won(o.left)} → ${items.map((i) => `${i.no.slice(-8)} ${won(i.amount)}`).join(" · ")}` +
      (o.left - used > 0 ? `  (${won(o.left - used)} 남김)` : ""));
    if (!GO) continue;

    for (const it of items) {
      await db.execute(sql`
        INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo, created_by)
        VALUES (${it.invoiceId}, ${it.amount}, '계좌이체', ${o.d},
                ${"통장 출금 연결 (밀린 지급 맞추기 2026-09-16)"}, NULL)
      `);
      await db.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_at)
        VALUES ('매입지급', 'cash_txn', ${o.id}, 'purchase_invoice', ${it.invoiceId}, ${it.amount}, '확정', '수동', now())
      `);
    }
    await db.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${o.id}`);
    await logActivity({
      ym: o.d.slice(0, 7),
      actor: null,
      how: "사람",
      verb: "지급",
      target: { table: "cash_txn", id: o.id },
      n: items.length,
      amount: used,
      label: `지급: ${o.d.slice(5)} ${won(used)} → ${supplier} (밀린 것 맞추기)`,
      undo: { kind: "pay", args: { cashTxnId: o.id } },
    });
  }
  const after = (await openInvoices(supplier)).reduce((s, i) => s + Number(i.remain), 0);
  console.log(`  ⇒ ${GO ? "지금" : "반영하면"} 미지급 ${won(after)}원`);
}

async function main() {
  console.log(GO ? "▶ 반영합니다" : "▶ 미리보기 (--go 를 붙이면 반영)");

  /* ① 제로 매입 부가세 이중 계상 바로잡기 */
  const [z] = await db.execute<{ id: number; subtotal: number; vat: number; total: number }>(sql`
    SELECT id, subtotal, vat, total FROM purchase_invoice WHERE id = 318
  `);
  console.log(`\n── 제로 8/15 매입(#318) ──\n  지금: 공급 ${won(z.subtotal)} + 부가세 ${won(z.vat)} = ${won(z.total)}`);
  console.log(`  고침: 부가세를 두 번 붙인 것을 뺀다 → 합계 ${won(844000)} (품목 금액 그대로)`);
  if (GO && z.total !== 844000) {
    await db.execute(sql`UPDATE purchase_invoice SET subtotal = 844000, vat = 0, total = 844000, updated_at = now() WHERE id = 318`);
    await logActivity({
      ym: "2026-08", actor: null, how: "사람", verb: "수정",
      target: { table: "purchase_invoice", id: 318 }, amount: 844000,
      label: "수정: 제로 8/15 매입 928,400 → 844,000 (부가세 두 번 붙은 것)",
      undo: null,
    });
  }

  /* ② 제로 9/10 송금 */
  const zeroOut = await db.execute<{ id: number }>(sql`
    SELECT id FROM cash_txn WHERE is_active AND source = '통장' AND out_amount = 844000
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date = '2026-09-10' AND description ILIKE '%제로%'
  `);
  await settle("제로", zeroOut.map((r) => Number(r.id)));

  /* ③ 나이스 오토파츠 — 8/25 · 9/1 · 9/11 송금 (앱 매입 등록 이후 것) */
  await settle("나이스 오토파츠", [6054, 6772, 6936]);

  process.exit(0);
}
main();
