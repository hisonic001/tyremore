/**
 * ⭐ 예약인데 「전액 받음」으로 저장된 건 — 보기 · 고치기 (2026-09-10)
 *
 *   실측: 예약중 8건 전부 payment_method 가 카드/현금/계좌이체이고 분할·수금 줄이 0 —
 *   앱은 전액 받은 줄 안다. 실제 받은 돈은 사장님만 아시므로 **일괄 변경하지 않는다.**
 *   화면(정비 내역 카드 ⚠「받은 돈 고치기」)이 정식 길이고, 이 스크립트는 목록 확인과
 *   메모 등으로 금액이 분명한 건을 터미널에서 고칠 때 쓴다.
 *
 * 보기:   npx tsx --env-file=.env.local scripts/list-reservation-paid.ts
 * 고치기: npx tsx --env-file=.env.local scripts/list-reservation-paid.ts --fix Q26-0910-002 카드:200000:2026-09-10
 *         (여러 줄은 쉼표로: 카드:200000:2026-09-10,현금:50000:2026-09-11 · 「없음」= 한 푼도 안 받음)
 *   → 정본 reservation-pay.ts 의 restateReservationPaid 와 같은 SQL (서버 액션은 세션이 필요해 몸통을 옮겼다)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { COLLECT_METHODS } from "@/lib/payments";
import { normalizeSettledReservation } from "@/lib/reservation-pay";

const won = (n: number) => Number(n).toLocaleString("ko-KR");

async function list() {
  const rows = await db.execute<{
    quote_no: string; d: string; who: string; total: number; payment_method: string; reservation_status: string;
    memo: string | null; paid: number; split: number;
  }>(sql`
    SELECT q.quote_no, to_char(COALESCE(q.work_date, q.created_at::date), 'MM-DD') d,
           COALESCE(q.supplier_name, c.name, '?') who, q.total_amount total, q.payment_method, q.reservation_status,
           q.payment_memo memo,
           COALESCE((SELECT SUM(amount) FROM receivable_payment rp WHERE rp.quote_id = q.id), 0)::int paid,
           (SELECT count(*) FROM quote_payment qp WHERE qp.quote_id = q.id)::int split
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.reservation_status = '예약중' AND q.claim_party IS NULL
    ORDER BY q.id DESC
  `);
  console.log(`── 예약중 ${rows.length}건 ──`);
  for (const r of rows) {
    const flag = r.payment_method === "외상" ? `외상 · 받음 ${won(r.paid)} / 잔금 ${won(Number(r.total) - Number(r.paid))}` : `⚠ ${r.payment_method} 전액 받은 것으로 저장`;
    console.log(`${r.quote_no}  ${r.d}  ${r.who}  ${won(r.total)}원  — ${flag}${r.memo ? `  📝 ${r.memo}` : ""}`);
  }
}

async function fix(quoteNo: string, spec: string) {
  const parts =
    spec === "없음"
      ? []
      : spec.split(",").map((s) => {
          const [method, amount, paidOn] = s.split(":");
          if (!COLLECT_METHODS.includes(method)) throw new Error(`수단이 올바르지 않습니다 — ${method}`);
          const n = Math.round(Number(amount));
          if (!Number.isFinite(n) || n <= 0) throw new Error(`금액이 올바르지 않습니다 — ${amount}`);
          if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new Error(`날짜는 2026-09-10 형식 — ${paidOn}`);
          return { method, amount: n, paidOn: paidOn || null };
        });
  const r = await db.transaction(async (tx) => {
    const [q] = await tx.execute<{ id: number; total: number; reservation_status: string | null; claim_party: string | null; status: string }>(
      sql`SELECT id, total_amount total, reservation_status, claim_party, status FROM quote WHERE quote_no = ${quoteNo} FOR UPDATE`);
    if (!q) throw new Error("그 번호의 판매가 없습니다");
    if (q.status === "취소" || !q.reservation_status || q.claim_party) throw new Error("예약 건이 아니거나 본사청구·취소 건입니다");
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    if (sum > Number(q.total)) throw new Error(`받은 돈 ${won(sum)} 이 합계 ${won(q.total)} 보다 큽니다`);
    await tx.execute(sql`DELETE FROM quote_payment WHERE quote_id = ${q.id}`);
    await tx.execute(sql`DELETE FROM receivable_payment WHERE quote_id = ${q.id}`);
    await tx.execute(sql`UPDATE quote SET payment_method = '외상', updated_at = now() WHERE id = ${q.id}`);
    for (const p of parts) {
      await tx.execute(sql`
        INSERT INTO receivable_payment (quote_id, amount, method, paid_on, memo)
        VALUES (${q.id}, ${p.amount}, ${p.method}, ${p.paidOn ?? sql`(now() AT TIME ZONE 'Asia/Seoul')::date`}, ${"예약금 — 받은 돈 고치기로 기록"})
      `);
    }
    const n = await normalizeSettledReservation(q.id, tx);
    return { total: Number(q.total), sum, converted: n.converted };
  });
  console.log(`✅ ${quoteNo}: 받은 돈 ${won(r.sum)} / ${won(r.total)} — 잔금 ${won(r.total - r.sum)}${r.converted ? " (전액이라 보통 결제로 정리됨)" : ""}`);
}

async function main() {
  const [mode, quoteNo, spec] = process.argv.slice(2);
  if (mode === "--fix") {
    if (!quoteNo || !spec) throw new Error("--fix <판매번호> <수단:금액:날짜,...|없음>");
    await fix(quoteNo, spec);
  }
  await list();
  process.exit(0);
}
main().catch((e) => { console.error("❌", (e as Error).message); process.exit(1); });
