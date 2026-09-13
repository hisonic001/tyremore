/**
 * ⭐ 개편 5단계 — 지역화폐정산·이자·지원금·기타입금 반쪽 줄 정리 (2026-09-13)
 *
 *   applyAutoCategories(expense-core) 는 이 세 성격에 category 만 찍고 recon_status 는 '미대조'로 뒀다.
 *   카드정산은 4단계(add-deposit-rule.ts ②)에서 맞췄고, 이번에 코드도 세 UPDATE 에 recon_status='확정' 을
 *   같이 찍게 고쳤으므로 과거 줄을 같은 모양으로 맞춘다. 화면·남은 수는 category 기준이라
 *   **보이는 숫자는 안 바뀌고**, 되돌리기(undoDepositKind)가 언제나 제 짝을 찾는다.
 *   실측 09-13: 지역화폐정산 14 · 이자·지원금 6 · 기타입금 3 = 23건, '제안' 0건.
 *
 * 🔴 '제안'(후보가 붙은 줄)은 건드리지 않는다 — 건수만 보고한다. 사람이 볼 것.
 *
 *   실행: npx tsx scripts/add-recon-status-backfill.ts --dry   (건수표만)
 *         npx tsx scripts/add-recon-status-backfill.ts         (실제, 멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const DRY = process.argv.includes("--dry");
const KINDS = ["지역화폐정산", "이자·지원금", "기타입금"] as const;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const table = await sql<{ category: string; recon_status: string; n: number; sum: string }[]>`
      SELECT category, recon_status, count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint sum
      FROM cash_txn
      WHERE source = '통장' AND is_active AND in_amount > 0 AND category IN ${sql(KINDS as unknown as string[])}
      GROUP BY 1, 2 ORDER BY 1, 2`;
    console.log("category × recon_status (통장 입금 줄):");
    for (const r of table) {
      const mark = r.recon_status === "미대조" ? " ← 맞출 것" : r.recon_status === "제안" ? " ← 후보 붙음, 안 건드림" : "";
      console.log(`  ${r.category} / ${r.recon_status}: ${r.n}건 ${Number(r.sum).toLocaleString("ko-KR")}원${mark}`);
    }
    const todo = table.filter((r) => r.recon_status === "미대조").reduce((a, r) => a + r.n, 0);
    if (DRY) {
      console.log(`\n(--dry 였습니다 — ${todo}건을 '확정'으로 맞출 예정, 아무것도 안 고쳤습니다)`);
      return;
    }
    if (todo === 0) {
      console.log("\n✅ 맞출 것 없음");
      return;
    }
    const r = await sql`
      UPDATE cash_txn SET recon_status = '확정'
      WHERE source = '통장' AND is_active AND in_amount > 0
        AND category IN ${sql(KINDS as unknown as string[])} AND recon_status = '미대조'
      RETURNING id`;
    console.log(`\n✅ ${r.length}건 '확정'으로 맞춤 (화면 숫자는 그대로 — 판정이 category 기준이라)`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
