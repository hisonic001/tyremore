/**
 * ⭐ 대사 전수 청소 (돈관리 근본책 1단계-C, 사장님 승인 2026-08-31)
 *
 *   미광전력은 표본일 뿐 — 같은 유형(계좌이체 판매인데 입금과 안 이어짐)이 8월에만 27건.
 *   세 단계로 청소한다:
 *
 *   ① 화면급 「짝 확실」 잇기 — 입금 정리 화면의 confirmSureDeposits 와 **같은 정본 셋**
 *      (depositReconData → depositTaxCandidates → depositSurePicks → core 들)을 그대로 호출.
 *   ② 이름 몰라도 확실한 잇기 (미광 유형) — 미연결 계좌이체 판매 ↔ 미확인 입금이
 *      **금액 정확 일치 + ±3일 + 양쪽 다 유일**할 때만 linkDepositToQuoteCore 로.
 *      잇는 순간 그 core 가 입금자명 별명(정미선→미광전력)도 배운다.
 *      🔴 후보가 둘이거나 금액이 다르면 안 잇는다 — 사람 몫으로 남긴다.
 *   ③ 별명 역학습 — 과거 확정된 이체입금·매입지급 자국 전부에서
 *      (입금·출금 이름 ↔ 고객 C:/거래처 S:) 를 party_alias 에 채운다. 이미 있으면 안 덮는다.
 *
 *   실행: npx tsx --env-file=.env.local scripts/reconcile-sweep-20260831.ts          (보기만)
 *         npx tsx --env-file=.env.local scripts/reconcile-sweep-20260831.ts --apply  (실행)
 *   되돌리기: 입금 정리 화면의 「연결 되돌리기」 (자국 단위).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { linkDepositToQuoteCore } from "@/lib/deposit-core";
import { depositReconData } from "@/lib/recon-data";
import { depositTaxCandidates, depositSurePicks } from "@/lib/deposit-tax";
import { confirmTaxToBankCore, confirmBankToTaxesCore } from "@/lib/recon-core";
import { normName } from "@/lib/recon-data";
import { payerKeyOf } from "@/lib/expense-cats";

const APPLY = process.argv.includes("--apply");
const YM = "2026-08";

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  /* ── ① 화면급 「짝 확실」 잇기 ── */
  console.log("① 짝 확실한 입금 잇기 (입금 정리 화면과 같은 규칙)");
  const data = await depositReconData(YM);
  const { cands, bundles } = await depositTaxCandidates(
    YM,
    data.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sure = depositSurePicks(data.open, cands, bundles);
  console.log(`  미확인 입금 ${data.open.length}건 중 짝 확실 ${sure.size}건`);
  for (const [cashId, pick] of sure) {
    const dep = data.open.find((s) => s.dep.id === cashId)!.dep;
    console.log(`  · ${dep.date.slice(5)} ${dep.payerName} ${dep.amount.toLocaleString()}원 → ${pick.kind === "quote" ? `판매 #${pick.quoteId}` : pick.kind === "tax" ? `계산서 #${pick.invId}` : `계산서 묶음 ${pick.invoiceIds.length}장`}`);
    if (!APPLY) continue;
    const r =
      pick.kind === "tax"
        ? await confirmTaxToBankCore(pick.invId, cashId, null)
        : pick.kind === "bundle"
          ? await confirmBankToTaxesCore(cashId, pick.invoiceIds, null)
          : await linkDepositToQuoteCore(cashId, pick.quoteId, null);
    if (!r.ok) console.log(`    ⚠️ 실패: ${r.error}`);
  }

  /* ── ② 이름 몰라도 확실한 잇기 (미광 유형) ── */
  console.log("\n② 금액·날짜가 유일하게 맞는 잇기 (이름 다른 입금 — 미광 유형)");
  const sales = await db.execute<{ id: number; quote_no: string; d: string; total: number; who: string }>(sql`
    SELECT q.id, q.quote_no, to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           q.total_amount total, COALESCE(q.supplier_name, c.name, '?') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method IN ('계좌이체', '혼합') AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${YM + "-01"}::date
      AND NOT EXISTS (SELECT 1 FROM recon_match m WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id)
    ORDER BY 3 LIMIT 100
  `);
  let auto = 0;
  let manual = 0;
  for (const s of sales) {
    // 같은 금액의 미연결 판매가 이 판매뿐인가 (±3일 창 안에서)
    const twin = sales.filter((x) => x.total === s.total && Math.abs(Date.parse(x.d) - Date.parse(s.d)) <= 3 * 86400000);
    const deps = await db.execute<{ id: number; d: string; description: string }>(sql`
      SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, c.description
      FROM cash_txn c
      WHERE c.source = '통장' AND c.is_active AND c.in_amount = ${s.total}
        AND c.recon_status IN ('미대조', '제안') AND c.category IS NULL
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${s.d}::date - 3 AND ${s.d}::date + 3
      LIMIT 3
    `);
    if (deps.length === 1 && twin.length === 1) {
      const dep = deps[0];
      console.log(`  ⚡ ${s.d.slice(5)} ${s.quote_no} ${s.who} ${s.total.toLocaleString()}원 ← ${dep.d} 입금 「${payerKeyOf("통장", dep.description)}」 (유일 일치)`);
      auto++;
      if (APPLY) {
        const r = await linkDepositToQuoteCore(Number(dep.id), Number(s.id), null);
        if (!r.ok) console.log(`    ⚠️ 실패: ${r.error}`);
      }
    } else if (deps.length > 0) {
      console.log(`  · ${s.d.slice(5)} ${s.quote_no} ${s.who} ${s.total.toLocaleString()}원 — 후보 ${deps.length}건/동액판매 ${twin.length}건 → 사람 몫 (추적 화면에서)`);
      manual++;
    }
  }
  console.log(`  = 자동 ${auto}건 · 사람 몫 ${manual}건 · 입금 자체가 없는 것 ${sales.length - auto - manual}건 (현금 수령·미수금일 것)`);

  /* ── ③ 별명 역학습 — 이미 있으면 안 덮는다 ── */
  console.log("\n③ 과거 확정 연결에서 별명 역학습");
  const learned = await db.execute<{ payer: string; pk: string; label: string }>(sql`
    SELECT DISTINCT ON (payer) payer, pk, label FROM (
      SELECT c.description payer,
             CASE WHEN q.supplier_name IS NOT NULL THEN 'S:' || q.supplier_name ELSE 'C:' || q.customer_id END pk,
             COALESCE('거래처 ' || q.supplier_name, cu.name, '고객 ' || q.customer_id) label
      FROM recon_match m
      JOIN cash_txn c ON c.id = m.src_id AND m.src_table = 'cash_txn'
      JOIN quote q ON q.id = m.ref_id AND m.ref_table = 'quote'
      LEFT JOIN customer cu ON cu.id = q.customer_id
      WHERE m.kind = '이체입금' AND m.status = '확정' AND (q.supplier_name IS NOT NULL OR q.customer_id IS NOT NULL)
      UNION ALL
      SELECT c.description, 'S:' || pi.supplier, '거래처 ' || pi.supplier
      FROM recon_match m
      JOIN cash_txn c ON c.id = m.src_id AND m.src_table = 'cash_txn'
      JOIN purchase_invoice pi ON pi.id = m.ref_id AND m.ref_table = 'purchase_invoice'
      WHERE m.kind = '매입지급' AND m.status = '확정'
    ) x ORDER BY payer LIMIT 300
  `);
  let taught = 0;
  for (const L of learned) {
    const payer = payerKeyOf("통장", L.payer);
    const key = normName(payer);
    if (key.length < 2) continue;
    const [ex] = await db.execute<{ k: string }>(sql`SELECT alias_key k FROM party_alias WHERE alias_key = ${key}`);
    if (ex) continue;
    console.log(`  · 「${payer}」 → ${L.label}`);
    taught++;
    if (APPLY) {
      await db.execute(sql`
        INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
        VALUES (${key}, ${payer}, ${L.pk}, ${L.label}) ON CONFLICT (alias_key) DO NOTHING
      `);
    }
  }
  console.log(`  = 새 별명 ${taught}개`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
