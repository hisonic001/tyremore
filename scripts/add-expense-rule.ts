/**
 * ERP ⑥ 경비 분류 — 분류 규칙 사전 (사장님 지시 2026-08-25)
 *
 *   통장 출금·법인카드 지출에 분류(임차료·인건비·공과금…)를 붙인다.
 *   한 번 분류하면 같은 상대는 다음부터 자동 — expense_rule 이 그 사전이다.
 *   key = 상대명 원문(통장은 「[적요] 」 뗀 내용, 카드는 가맹점명) — 은행·카드사가
 *   같은 상대를 늘 같은 글자로 보내와 원문 그대로가 가장 정확하다.
 *
 *   npx tsx scripts/add-expense-rule.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS expense_rule (
        id         bigserial PRIMARY KEY,
        key        text NOT NULL UNIQUE,   -- 상대명 원문
        category   text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;

    // 백필 ① 내부이체 — 우리 상호가 적힌 통장 입출금은 계좌끼리 옮긴 돈이다
    const internal = await sql`
      UPDATE cash_txn SET category = '내부이체'
      WHERE category IS NULL AND source = '통장' AND description LIKE '%싸이오토모%'
      RETURNING id`;
    console.log(`내부이체 백필: ${internal.length}건`);

    console.log("✅ expense_rule 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
