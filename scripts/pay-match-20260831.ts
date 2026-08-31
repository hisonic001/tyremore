/**
 * ⭐ 미지급 정리 ① — 통장 출금과 원단위까지 맞는 지급을 기입 (사장님 요청 2026-08-31)
 *
 *   "미지급이 너무 밀려있는 형태가 되어서 뭘 어떻게 해야할지 모르겠음"
 *
 *   실측: 미지급 39장 81,405,287원 중 아래 29,175,212원은 **이미 통장에서 나갔다** —
 *   출금 금액이 인보이스(또는 같은 날 인보이스 묶음)와 정확히 일치한다.
 *   근거가 원단위 일치라 자동 기입해도 안전하고, memo 에 출금 날짜를 남겨
 *   나중에 「왜 지급됐지?」에 답할 수 있다. 잘못이면 미지급 화면의 「최근 지급」에서 지운다.
 *
 *   | 출금(신한 통장)      | 인보이스                                   |
 *   |---------------------|--------------------------------------------|
 *   | 08-13 2,390,300     | 콘티 CO-…4236 + CO-…4237 (08-13 2장 합)     |
 *   | 08-21 1,267,750     | 콘티 CO-…5216                              |
 *   | 08-26 2,233,000     | 콘티 CO-…5887 + CO-…5888 (2장 합)           |
 *   | 08-28 2,132,460     | 콘티 CO-…6266+6267+6268 (3장 합)            |
 *   | 08-05 1,203,048     | 미쉐린 KR_4520270364                       |
 *   | 08-12 16,045,568    | 미쉐린 KR_SI26+096341                      |
 *   | 08-21   591,294     | 미쉐린 KR_4520276463                       |
 *   | 08-25 3,311,792     | 미쉐린 KR_4520277548                       |
 *
 *   실행: npx tsx --env-file=.env.local scripts/pay-match-20260831.ts          (보기만)
 *         npx tsx --env-file=.env.local scripts/pay-match-20260831.ts --apply  (실행)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const APPLY = process.argv.includes("--apply");

/** 인보이스 번호 → 지급 (출금일·금액은 그 인보이스 total 전액) */
const PLAN: { invoiceNo: string; paidOn: string; bankNote: string }[] = [
  { invoiceNo: "CO-8154274236", paidOn: "2026-08-13", bankNote: "출금 2,390,300 중" },
  { invoiceNo: "CO-8154274237", paidOn: "2026-08-13", bankNote: "출금 2,390,300 중" },
  { invoiceNo: "CO-8154275216", paidOn: "2026-08-21", bankNote: "출금 1,267,750" },
  { invoiceNo: "CO-8154275887", paidOn: "2026-08-26", bankNote: "출금 2,233,000 중" },
  { invoiceNo: "CO-8154275888", paidOn: "2026-08-26", bankNote: "출금 2,233,000 중" },
  { invoiceNo: "CO-8154276266", paidOn: "2026-08-28", bankNote: "출금 2,132,460 중" },
  { invoiceNo: "CO-8154276267", paidOn: "2026-08-28", bankNote: "출금 2,132,460 중" },
  { invoiceNo: "CO-8154276268", paidOn: "2026-08-28", bankNote: "출금 2,132,460 중" },
  { invoiceNo: "KR_4520270364", paidOn: "2026-08-05", bankNote: "출금 1,203,048" },
  { invoiceNo: "KR_SI26+096341", paidOn: "2026-08-12", bankNote: "출금 16,045,568" },
  { invoiceNo: "KR_4520276463", paidOn: "2026-08-21", bankNote: "출금 591,294" },
  { invoiceNo: "KR_4520277548", paidOn: "2026-08-25", bankNote: "출금 3,311,792" },
];

async function payablesTotal(): Promise<number> {
  const [r] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE(pp.paid, 0)), 0)::bigint s
    FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > COALESCE(pp.paid, 0)
  `);
  return Number(r.s);
}

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");
  console.log(`지금 「줄 돈」: ${(await payablesTotal()).toLocaleString()}원\n`);

  let put = 0;
  for (const p of PLAN) {
    const [inv] = await db.execute<{ id: number; supplier: string; total: number; paid: string }>(sql`
      SELECT pi.id, pi.supplier, pi.total,
             COALESCE((SELECT SUM(pp.amount) FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
      FROM purchase_invoice pi WHERE pi.invoice_no = ${p.invoiceNo} AND pi.status <> '취소'
    `);
    if (!inv) {
      console.log(`  ⚠️ ${p.invoiceNo} — 인보이스 없음 (건너뜀)`);
      continue;
    }
    const remain = Number(inv.total) - Number(inv.paid);
    if (remain <= 0) {
      console.log(`  · ${p.invoiceNo} — 이미 지급됨 (건너뜀)`);
      continue;
    }
    console.log(`  · ${inv.supplier} ${p.invoiceNo}  ${remain.toLocaleString()}원 ← ${p.paidOn} 계좌이체 (${p.bankNote})`);
    put += remain;
    if (APPLY) {
      await db.execute(sql`
        INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo)
        VALUES (${Number(inv.id)}, ${remain}, '계좌이체', ${p.paidOn},
                ${"통장 출금 원단위 일치 — 자동 대조 2026-08-31 (" + p.bankNote + ")"})
      `);
    }
  }
  console.log(`\n기입 합계: ${put.toLocaleString()}원 (예상 29,175,212원)`);
  if (APPLY) console.log(`끝난 뒤 「줄 돈」: ${(await payablesTotal()).toLocaleString()}원`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500));
