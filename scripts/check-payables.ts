/**
 * ⭐ 확인: 아직 안 고친 매입 지급 문제가 터지기 시작했나 (2회차 2순위 감시, 2026-08-28)
 *
 *   🔴 이건 「고친 것 지킴이」가 아니라 **「안 고친 것 감시」**다.
 *
 *   2회차에서 「출금에서 지급 잡기」 쪽 결함 셋(A6·B1·B2)을 찾았지만 안 고쳤다 —
 *   그 기능이 **한 번도 안 쓰였기 때문**이다(2026-08-28: purchase_payment 0건).
 *   쓰이기 시작하는 순간 셋 다 실제 피해가 된다:
 *     A6 「남은 돈 N원」을 총액으로 세어 이미 쓴 몫까지 남았다고 말한다
 *     B1 되돌려도 그때 배운 별명이 안 지워져 잘못된 상대가 계속 되살아난다
 *     B2 지급을 0건 지우고도 「되돌렸습니다」라 하고 출금만 다시 열어 이중 배분이 된다
 *
 *   그래서 이 스크립트는 **기능이 쓰이기 시작하면 크게 알린다.**
 *   그때가 2순위를 고칠 때다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-payables.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const NL = "\n";
let bad = 0;
const num = (n: number) => n.toLocaleString("ko-KR");
function ok(name: string, pass: boolean, detail: string) {
  if (!pass) bad++;
  console.log("  " + (pass ? "✓" : "⚠") + " " + name.padEnd(38) + " " + detail);
}
const head = (s: string) => console.log(NL + "  " + s + NL);

async function main() {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  console.log(NL + "── 매입 지급 감시 (안 고친 2순위) ──");

  /* ══════ 기능이 쓰이기 시작했나 ══════ */
  head("[상태] 「출금에서 지급 잡기」가 쓰이기 시작했나");
  const [use] = await db.execute<{ pp: number; linked: number; marks: number }>(sql`
    SELECT (SELECT count(*) FROM purchase_payment)::int pp,
           (SELECT count(*) FROM purchase_payment WHERE memo LIKE '통장 출금 연결%')::int linked,
           (SELECT count(*) FROM recon_match WHERE kind = '매입지급' AND status = '확정')::int marks
  `);
  console.log("      지급 기록 " + use.pp + "건 (그중 출금에서 이은 것 " + use.linked + "건) · 연결 자국 " + use.marks + "개");
  if (use.marks === 0 && use.linked === 0) {
    console.log("      → 아직 안 쓴 기능이다. 2순위(A6·B1·B2)는 지금은 피해가 없다.");
  } else {
    ok(
      "2순위를 아직 안 고쳤는데 기능이 쓰이기 시작했다",
      false,
      "A6·B1·B2 를 먼저 고칠 것 — docs/review/회차2.md 참고",
    );
  }

  /* ══════ B2 증상: 자국과 지급 기록이 짝이 안 맞는가 ══════ */
  head("[B2] 연결 자국과 지급 기록이 짝을 이루나");
  const [orphanMark] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM recon_match m
    WHERE m.kind = '매입지급' AND m.status = '확정'
      AND NOT EXISTS (SELECT 1 FROM purchase_payment pp
                       WHERE pp.invoice_id = m.ref_id AND pp.amount = m.amount
                         AND pp.memo LIKE '통장 출금 연결%')
  `);
  ok("지급 기록 없는 자국 없음", Number(orphanMark.n) === 0,
     Number(orphanMark.n) === 0 ? "0개" : orphanMark.n + "개 — 되돌리기가 반만 됐다");

  const [orphanPay] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM purchase_payment pp
    WHERE pp.memo LIKE '통장 출금 연결%'
      AND NOT EXISTS (SELECT 1 FROM recon_match m
                       WHERE m.kind = '매입지급' AND m.status = '확정'
                         AND m.ref_id = pp.invoice_id AND m.amount = pp.amount)
  `);
  ok("자국 없는 지급 기록 없음", Number(orphanPay.n) === 0,
     Number(orphanPay.n) === 0 ? "0건" : orphanPay.n + "건 — 자국만 지워지고 지급이 남았다 (이중 배분 위험)");

  /* ══════ A6 계열: 한 출금에 배분된 몫이 그 출금보다 크지 않은가 ══════ */
  head("[A6] 출금 한 줄이 자기 금액보다 많이 배분되지 않았나");
  const over = await db.execute<{ id: number; out_amount: number; used: string; d: string }>(sql`
    SELECT c.id, c.out_amount, u.used, left(c.description, 24) d
    FROM cash_txn c JOIN (
      SELECT cash_id, SUM(amount) used FROM (
        SELECT ref_id cash_id, amount FROM recon_match
         WHERE ref_table = 'cash_txn' AND kind IN ('매입계산서', '매출계산서') AND status = '확정'
        UNION ALL
        SELECT src_id, amount FROM recon_match
         WHERE src_table = 'cash_txn' AND kind IN ('매입지급', '이체입금') AND status = '확정'
      ) x GROUP BY 1
    ) u ON u.cash_id = c.id
    WHERE c.out_amount > 0 AND u.used > c.out_amount
    ORDER BY u.used - c.out_amount DESC LIMIT 5
  `);
  ok(
    "초과 배분된 출금 없음",
    over.length === 0,
    over.length === 0 ? "0줄" : over.map((o) => o.d + " " + num(Number(o.out_amount)) + "원에 " + num(Number(o.used)) + "원 배분").join(" | "),
  );

  /* ══════ ★1: 「줄 돈」이 실제 미지급인가 ══════ */
  head("[★1] 「줄 돈」 숫자가 무엇을 뜻하나");
  const [rem] = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE(pp.paid, 0)), 0)::bigint s, count(*)::int n
    FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > COALESCE(pp.paid, 0)
  `);
  console.log("      /finance/payables 「줄 돈」 = " + num(Number(rem.s)) + "원 (" + rem.n + "장)");
  if (use.pp === 0) {
    console.log("      🔴 지급 기록이 0건이라 **매입 인보이스 총액 그대로**다 — 실제로는 통장에서 이미 나갔다.");
    console.log("         이 숫자로 자금 계획을 세우면 안 된다 (2회차 ★1).");
  }
  const [zero] = await db.execute<{ n: number; all: number }>(sql`
    SELECT count(*) FILTER (WHERE total IS NULL OR total = 0)::int n, count(*)::int all
    FROM purchase_invoice WHERE status <> '취소'
  `);
  console.log("      매입 인보이스 " + zero.all + "장 중 금액이 0원·빈 것 " + zero.n + "장 (2회차 ★4 — 원인 미확인)");

  console.log(bad === 0 ? NL + "  결과: 지금은 피해 없음 ✓" + NL : NL + "  결과: ⚠ " + bad + "곳 — 2순위를 고칠 때다" + NL);
  process.exit(bad === 0 ? 0 : 1);
}
main();
