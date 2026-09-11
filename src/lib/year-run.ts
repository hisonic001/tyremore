/**
 * ⭐ 한 달 「진행」 실행기 (사장님 요청 2026-08-26 — "2025년을 시뮬레이션이 아니라 정말 진행")
 *
 *   사장님이 화면에서 누르는 것과 **같은 규칙·같은 코어 함수**로 그 달을 처리한다:
 *   ① 자동 분류(카드정산·내부이체·지역화폐·주주거래·배운 경비 규칙)
 *   ② 입금: 카드정산 표시 → 짝이 확실한 것(정확+★ 계산서 / ★ 판매 / 정확 묶음) 잇기 — 2회(배운 별명 효과)
 *   ③ 계산서(매입·매출): 짝이 확실한 것 잇기 → 월정산 상대 [이 달 맞음](매입)
 *   ④ 스냅샷 + 남은 일 목록(문제 도출 재료)
 *   마감은 안 누른다. 전부 되돌릴 수 있다(자국 method '자동', scripts/revert-year-run.ts).
 *
 * 🔴 "use server" 아님 — 스크립트(scripts/run-year.ts)가 부른다. 질의 순차.
 */
import { applyAutoCategories, type AutoCatResult } from "./expense-core";
import { markCardSettlementsCore, linkDepositToQuoteCore } from "./deposit-core";
import { confirmBankToTaxesCore, confirmMonthlyPartyCore, confirmSureTaxCore, confirmTaxToBankCore } from "./recon-core";
import { depositOpenCount, depositReconData, expenseData, expenseOpen } from "./recon-data";
import { depositSurePicks, depositTaxCandidates } from "./deposit-tax";
import { taxCashData, taxOpenCounts } from "./tax-recon";

export interface MonthReport {
  ym: string;
  autoCat: AutoCatResult;
  cardMarked: number;
  depositLinked: { tax: number; quote: number; bundle: number; failed: number };
  taxLinked: { buy: number; sell: number; failed: number };
  monthly: { name: string; invSum: number; paidSum: number; balance: number; applied: number }[];
  before: { dep: number; exp: number; taxBuy: number; taxSell: number };
  after: { dep: number; exp: number; taxBuy: number; taxSell: number };
  leftDeposits: { d: string; payer: string; amount: number; hint: string }[];
  leftTax: { direction: string; d: string; name: string; total: number; hint: string }[];
  leftExpense: { payer: string; n: number; sum: number }[];
  errors: string[];
}

export async function runMonth(ym: string, uid: number | null, log: (s: string) => void = () => {}): Promise<MonthReport> {
  const errors: string[] = [];
  const before = await snapshot(ym);
  log(`── ${ym} 시작: 입금 ${before.dep} · 지출 미분류 ${before.exp} · 계산서 매입 ${before.taxBuy} 매출 ${before.taxSell}`);

  // ① 자동 분류
  const autoCat = await applyAutoCategories({ ym }, uid);
  // ② 입금
  const cardMarked = await markCardSettlementsCore(ym, uid);
  const depositLinked = { tax: 0, quote: 0, bundle: 0, failed: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const data = await depositReconData(ym);
    const { cands, bundles } = await depositTaxCandidates(
      ym,
      data.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
    );
    const sure = depositSurePicks(data.open, cands, bundles);
    if (sure.size === 0) break;
    for (const [cashId, pick] of sure) {
      try {
        const r =
          pick.kind === "tax"
            ? await confirmTaxToBankCore(pick.invId, cashId, uid, "자동")
            : pick.kind === "bundle"
              ? await confirmBankToTaxesCore(cashId, pick.invoiceIds, uid, "자동")
              : await linkDepositToQuoteCore(cashId, pick.quoteId, uid, "자동");
        if (!r.ok) {
          depositLinked.failed++;
          errors.push(`입금 ${cashId} ${pick.kind}: ${r.error}`);
        } else depositLinked[pick.kind]++;
      } catch (e) {
        depositLinked.failed++;
        errors.push(`입금 ${cashId} 예외: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  // ③ 계산서
  const taxLinked = { buy: 0, sell: 0, failed: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const b = await confirmSureTaxCore(ym, "매입", uid, "자동");
    const s = await confirmSureTaxCore(ym, "매출", uid, "자동");
    taxLinked.buy += b.applied;
    taxLinked.sell += s.applied;
    taxLinked.failed += b.failed + s.failed;
    if (b.applied + s.applied === 0) break;
  }
  // 월정산 [이 달 맞음] — 매입만 (채무 장부)
  const monthly: MonthReport["monthly"] = [];
  const buy = await taxCashData("매입", ym);
  for (const m of buy.monthly) {
    const r = await confirmMonthlyPartyCore(m.bizNo, ym, "매입", uid, "자동");
    monthly.push({ name: m.name, invSum: m.invSum, paidSum: m.paidSum, balance: m.balance, applied: r.ok ? r.applied : 0 });
  }
  // ④ 스냅샷 + 남은 일
  const after = await snapshot(ym);
  const dep = await depositReconData(ym);
  const { cands: dc, bundles: db2 } = await depositTaxCandidates(
    ym,
    dep.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const leftDeposits = dep.open.slice(0, 40).map((s) => ({
    d: s.dep.date.slice(5),
    payer: s.dep.payerName,
    amount: s.dep.amount,
    hint: db2[s.dep.id]
      ? `묶음(${db2[s.dep.id].diff === 0 ? "정확" : "근사"})`
      : (dc[s.dep.id]?.length ?? 0) > 0
        ? `계산서 후보 ${dc[s.dep.id].map((c) => (c.exact ? (c.known ? "정확★" : "정확·이름다름") : c.known ? "★금액차" : "≈")).join("/")}`
        : s.quotes.length > 0
          ? `판매 후보 ${s.quotes.length}${s.quotes.some((q) => q.nameOk) ? "(★)" : "(이름다름)"}`
          : s.parties.length > 0
            ? "외상 후보"
            : "후보 없음",
  }));
  const leftTax: MonthReport["leftTax"] = [];
  for (const dir of ["매입", "매출"] as const) {
    const t = dir === "매입" ? buy : await taxCashData("매출", ym);
    const t2 = dir === "매입" ? await taxCashData("매입", ym) : t; // 월정산 처리 뒤 재조회
    for (const r of t2.rows.slice(0, 30)) {
      const remain = r.total - r.bankCovered;
      const exact = r.autoBank.filter((b) => b.amount === remain);
      leftTax.push({
        direction: dir,
        d: r.d,
        name: r.name,
        total: r.total,
        hint: r.isFix
          ? "마이너스 계산서(상쇄 필요)"
          : r.fixFirst
            ? "상쇄 먼저"
            : r.bankCombo
              ? `묶음(${r.bankCombo.diff === 0 ? "정확" : "근사"}·${r.bankCombo.ids.length}줄)`
              : exact.length > 1
                ? `정확 일치 ${exact.length}건(애매)`
                : exact.length === 1
                  ? "정확·이름다름"
                  : r.autoBank.length > 0
                    ? `★/≈ 후보 ${r.autoBank.length}(금액 차이)`
                    : r.bankCovered > 0
                      ? "일부 확인"
                      : "후보 없음",
      });
    }
  }
  const ed = await expenseData(ym);
  const leftExpense = ed.byPayer.slice(0, 12).map((p) => ({ payer: p.payer, n: p.n, sum: p.sum }));
  log(`   끝: 입금 ${after.dep} · 지출 ${after.exp} · 계산서 매입 ${after.taxBuy} 매출 ${after.taxSell} | 잇기 입금 ${depositLinked.tax + depositLinked.quote + depositLinked.bundle} 계산서 ${taxLinked.buy + taxLinked.sell} 월정산 ${monthly.reduce((s, m) => s + m.applied, 0)}장`);
  return { ym, autoCat, cardMarked, depositLinked, taxLinked, monthly, before, after, leftDeposits, leftTax, leftExpense, errors };
}

async function snapshot(ym: string) {
  const dep = await depositOpenCount(ym);
  const exp = (await expenseOpen(ym)).n;
  const t = await taxOpenCounts(ym);
  return { dep, exp, taxBuy: t.buy, taxSell: t.sell };
}
