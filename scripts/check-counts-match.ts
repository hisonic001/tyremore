/**
 * ⭐ 확인: 화면마다 숫자가 갈라지지 않았나 (1회차 Finding 1 지킴이, 2026-08-28)
 *
 *   무엇을 지키나 — 같은 달을 보는데 **첫 화면 카드**와 **돈 확인 탭**과 **월 마감 체크리스트**가
 *   서로 다른 숫자를 말하는 일. 이 앱에서 세 번 재발했다:
 *     감사 C1 → 감사 N1 → 2026-08-28 「대기」 (미룬 계산서를 현황·마감만 계속 셌다)
 *   세는 규칙을 손으로 두 번 적으면 반드시 갈라진다. 그래서 값을 나란히 놓고 본다.
 *
 *   🔴 읽기 전용. 자료를 바꾸지 않는다.
 *
 *   npx tsx scripts/check-counts-match.ts            최근 3달 + 2025 표본
 *   npx tsx scripts/check-counts-match.ts 2026-06    그 달만
 */
import { config } from "dotenv";
config({ path: ".env.local" });

let bad = 0;

async function main() {
  const { taxOpenCount, taxOpenCounts, taxCashData } = await import("../src/lib/tax-recon");
  const { depositOpenCount, depositReconData } = await import("../src/lib/recon-data");
  const { expenseOpen, expenseData } = await import("../src/lib/recon-data");
  const { kstToday, ymAdd } = await import("../src/lib/ym");

  const arg = process.argv[2];
  const now = kstToday().slice(0, 7);
  const months = arg && /^\d{4}-\d{2}$/.test(arg) ? [arg] : [now, ymAdd(now, -1), ymAdd(now, -2), "2026-01", "2025-06"];

  for (const ym of months) {
    console.log(`\n── ${ym} ──`);

    /* ① 세금계산서 「돈 확인할 것」
          현황 카드·월 마감 = taxOpenCounts / taxOpenCount
          돈 확인 화면      = taxCashData(...).open.n
       두 값이 다르면 사장님이 같은 달에서 다른 숫자를 보신다. */
    const by = await taxOpenCounts(ym);
    const one = await taxOpenCount(ym);
    const buy = await taxCashData("매입", ym);
    const sell = await taxCashData("매출", ym);
    const line = (name: string, a: number, b: number, aLabel: string, bLabel: string) => {
      const same = a === b;
      if (!same) bad++;
      console.log(`  ${same ? "✓" : "⚠"} ${name.padEnd(22)} ${aLabel} ${a}  ${same ? "=" : "≠"}  ${bLabel} ${b}`);
    };
    line("계산서 매입", by.buy, buy.open.n, "현황·마감", "돈확인화면");
    line("계산서 매출", by.sell, sell.open.n, "현황·마감", "돈확인화면");
    if (one !== by.buy + by.sell) {
      bad++;
      console.log(`  ⚠ 합계가 안 맞음: taxOpenCount ${one} ≠ ${by.buy}+${by.sell}`);
    }

    /* 「대기」(아직 안 들어옴)가 어느 쪽에도 안 세여야 한다 — 그게 이 상태를 만든 이유다 */
    const waitN = buy.waiting.length + sell.waiting.length;
    if (waitN > 0) console.log(`    · 미뤄 둔 계산서 ${waitN}건 — 위 숫자 어느 쪽에도 안 들어가야 정상`);

    /* ② 입금 정리할 것 — 현황·체크리스트(depositOpenCount) vs 입금 화면(openTotal) */
    const depN = await depositOpenCount(ym);
    const dep = await depositReconData(ym);
    line("입금 정리할 것", depN, dep.openTotal, "현황·마감", "입금화면");

    /* ③ 분류 안 된 지출 — 현황·체크리스트(expenseOpen) vs 지출 화면(unclassifiedCount) */
    const exp = await expenseOpen(ym);
    const ed = await expenseData(ym);
    line("분류 안 된 지출", exp.n, ed.unclassifiedCount, "현황·마감", "지출화면");
    if (exp.sum !== ed.unclassifiedTotal) {
      bad++;
      console.log(`  ⚠ 지출 합계가 다름: 현황 ${exp.sum.toLocaleString()}원 ≠ 화면 ${ed.unclassifiedTotal.toLocaleString()}원`);
    }
  }

  console.log(
    bad === 0
      ? "\n결과: 화면끼리 숫자가 다 맞는다 ✓\n"
      : `\n결과: 어긋난 곳 ${bad}군데 ⚠ — 세는 규칙이 두 벌로 갈라졌다는 뜻이다\n`,
  );
  process.exit(bad === 0 ? 0 : 1);
}
main();
