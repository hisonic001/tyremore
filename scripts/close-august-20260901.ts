/**
 * ⭐ 2026-08 월 마감 대행 (사장님 위임 2026-08-31 — "일단 8월은 알아서 마감까지 한번 니가 해봐")
 *
 *   실측: 마감을 막는 것은 매입 세금계산서 3장뿐이었다 (그 밖 입금·지출·일마감·검증 ✓).
 *   셋 다 월정산 상대라, 화면과 같은 정본으로 처리한다:
 *
 *   ① 강남세차장 #696 (14,322,000) → 「아직 안 줌 — 다음 달로」(대기)
 *      근거: 사장님 확인 2026-08-31 "강남세차장은 다음달에 이체 예정".
 *      markTaxWaiting 화면 액션과 같은 SQL (recon_status='대기', reason='아직 안 들어옴').
 *   ② 미쉐린 #108 (1,045,000) · 딜러타이어 #105 (509,400) → 월정산 「이 달 맞음」
 *      근거: 미쉐린 8월 이체 41.6M(즉시이체 관행)·딜러 예치금 600,000 충전이 계산서를 덮는다.
 *      confirmMonthlyPartyCore 정본 그대로 호출.
 *   ③ 마감 조건 재검사(closeChecklist 정본) → 통과 시 month_close 기입
 *      (closeMonth 본문과 같은 순서·같은 headline, closed_by=사장님 uid 1 — 위임 대행).
 *
 *   실행: npx tsx --env-file=.env.local scripts/close-august-20260901.ts [--apply]
 *   되돌리기: 마감 풀기(/finance 마감 카드) · 대기/월정산은 세금계산서 화면에서 되돌리기.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { confirmMonthlyPartyCore } from "@/lib/recon-core";
import { closeChecklist } from "@/lib/month-close";
import { finPL } from "@/lib/fin-pl";

const APPLY = process.argv.includes("--apply");
const YM = "2026-08";

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  /* ① 강남세차장 — 다음 달 이체 예정 → 대기 */
  const [gn] = await db.execute<{ id: number; st: string }>(sql`
    SELECT id, recon_status st FROM tax_invoice WHERE id = 696 AND is_active
  `);
  if (gn && gn.st !== "대기" && gn.st !== "확정") {
    console.log("① 강남세차장 14,322,000 → 「아직 안 줌 — 다음 달로」 (사장님 확인: 다음달 이체 예정)");
    if (APPLY) {
      await db.execute(sql`
        UPDATE tax_invoice SET recon_status = '대기', recon_reason = '아직 안 들어옴' WHERE id = 696
      `);
    }
  } else {
    console.log(`① 강남세차장 — 이미 ${gn?.st ?? "없음"} (건너뜀)`);
  }

  /* ② 미쉐린·딜러타이어 — 월정산 「이 달 맞음」 */
  for (const [name, biz] of [["미쉐린코리아(주)", "2148133583"], ["주식회사 딜러타이어", "1908701166"]] as const) {
    console.log(`② ${name} — 월정산 「이 달 맞음」`);
    if (APPLY) {
      const r = await confirmMonthlyPartyCore(biz, YM, "매입");
      console.log(`   ${r.ok ? `확정 ${r.applied}장` : `⚠️ ${r.error}`}`);
    }
  }

  /* ③ 마감 조건 재검사 → 기입 */
  const checks = await closeChecklist(YM);
  const bad = checks.filter((c) => !c.ok && !c.soft);
  console.log("\n③ 마감 조건:");
  for (const c of checks) console.log(`  ${c.ok ? "✓" : c.soft ? "⚠(참고)" : "🔴"} ${c.text}`);
  if (bad.length > 0) {
    console.log(`\n🔴 아직 막는 것 ${bad.length}건 — 마감 기입 안 함`);
    return;
  }
  const pl = await finPL(YM);
  const headline = {
    earned: pl.earnedTotal, bought: pl.bought, cardOut: pl.cardOut, fee: pl.feeShown,
    feeEstimated: pl.feeEstimated > 0, bankExp: pl.bankExp, profit: pl.profit, dataComplete: pl.dataComplete,
  };
  console.log(`\n마감 숫자: 번 돈 ${pl.earnedTotal.toLocaleString()} · 쓴 돈 ${pl.spent.toLocaleString()} · 남은 돈 ${pl.profit?.toLocaleString?.() ?? pl.profit}`);
  if (APPLY) {
    await db.execute(sql`
      INSERT INTO month_close (ym, closed_by, headline)
      VALUES (${YM}, 1, ${JSON.stringify(headline)}::jsonb)
      ON CONFLICT (ym) DO NOTHING
    `);
    console.log("✅ 2026-08 마감 기입 완료 (마감 풀기로 언제든 되돌릴 수 있습니다)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
