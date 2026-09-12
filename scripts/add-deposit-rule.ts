/**
 * ⭐ 개편 4단계 — 입금 성격 규칙 표 + 카드정산 반쪽 줄 정리 (2026-09-12)
 *
 *   ① deposit_rule — 「이 입금자는 판매입금/이자·지원금/환불/기타입금」을 기억한다.
 *      지금은 setDepositKind 가 그 줄만 고치고 입금자를 안 외워서, 같은 상대가 다음 달에
 *      또 들어와도 처음부터 고르셔야 했다. key = payerKeyOf("통장", 적요) — expense_rule 과 같은 열쇠.
 *
 *   ② 카드정산 반쪽 줄 정리: applyAutoCategories 는 category='카드정산' 만 찍고 recon_status 는
 *      '미대조'로 두는데, markCardSettlements·setDepositKind·unmarkCardSettlement 는 두 칸을
 *      같이 다룬다. 화면·남은 수는 category 기준이라 **보이는 숫자는 안 바뀌고**, 두 칸을
 *      맞춰 두면 되돌리기(unmarkCardSettlement)가 언제나 제 짝을 찾는다.
 *
 *   실행: npx tsx scripts/add-deposit-rule.ts --dry   (건수만 보기)
 *         npx tsx scripts/add-deposit-rule.ts         (실제, 멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const DRY = process.argv.includes("--dry");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    /* ① 입금 성격 규칙 — 값은 lib/fin-deposits.ts 의 DEPOSIT_KINDS 와 같아야 한다 */
    if (DRY) {
      const [t] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM information_schema.tables WHERE table_name = 'deposit_rule'`;
      console.log(`① deposit_rule 표: ${t.n > 0 ? "이미 있음" : "새로 만듦"}`);
    } else {
      await sql`
        CREATE TABLE IF NOT EXISTS deposit_rule (
          id         bigserial PRIMARY KEY,
          key        text NOT NULL UNIQUE,   -- 입금자 이름 원문 (payerKeyOf)
          kind       text NOT NULL CHECK (kind IN ('판매입금', '이자·지원금', '환불', '기타입금')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`;
      console.log("① deposit_rule 준비됨");
    }

    /* ② 카드정산 반쪽 줄 — category 는 있는데 recon_status 가 미대조인 것 */
    const [c] = await sql<{ n: number; sum: string }[]>`
      SELECT count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint sum
      FROM cash_txn
      WHERE source = '통장' AND is_active AND category = '카드정산' AND recon_status = '미대조'`;
    console.log(`② 카드정산 반쪽 줄: ${c.n}건 ${Number(c.sum).toLocaleString("ko-KR")}원`);
    if (!DRY && c.n > 0) {
      const r = await sql`
        UPDATE cash_txn SET recon_status = '확정'
        WHERE source = '통장' AND is_active AND category = '카드정산' AND recon_status = '미대조'
        RETURNING id`;
      console.log(`   → ${r.length}건 '확정'으로 맞춤 (화면 숫자는 그대로 — 판정이 category 기준이라)`);
    }

    console.log(DRY ? "\n(--dry 였습니다 — 아무것도 안 고쳤습니다)" : "\n✅ 끝");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
