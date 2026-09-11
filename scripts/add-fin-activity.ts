/**
 * ⭐ 「최근 한 일」 표 fin_activity (개편 2단계, 2026-09-12)
 *
 *   사장님 결정 14·15: 되돌리기는 「최근 한 일」 한 곳에, 마감 뒤 고치면 기록에 남고 차이를 보여 준다.
 *   조사(09-11): cash_txn·tax_invoice 에 updated_at 이 없고, undoTaxMatch·undoDepositLink·undoPayFromWithdrawal 은
 *   자국을 날 DELETE 해서 기존 표로는 「방금 뭘 했는지」를 반쯤밖에 못 만든다 → 기록 표 하나.
 *
 *   · 되돌린 줄은 지우지 않고 undone_at 만 찍는다.
 *   · 일괄(자동 대사 12건)은 한 줄에 n + undo_args.items 로 접는다.
 *   · after_close: 대상 달(ym)이 이미 마감된 달이면 true — 첫 화면 「8월 마감 뒤 고친 것 N건」.
 *
 *   실행: npx tsx --env-file=.env.local scripts/add-fin-activity.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS fin_activity (
        id bigserial PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now(),
        ym text,
        actor bigint,
        how text NOT NULL CHECK (how IN ('사람','자동','조정','cron','연간실행')),
        verb text NOT NULL CHECK (verb IN ('대사','되돌리기','분류','규칙','보류','제외','수금','지급','마감','올리기','수정')),
        target_table text,
        target_id bigint,
        n integer NOT NULL DEFAULT 1,
        amount bigint,
        label text NOT NULL,
        undo_kind text,
        undo_args jsonb,
        undone_at timestamptz,
        undone_by bigint,
        after_close boolean NOT NULL DEFAULT false
      )`;
    await sql`CREATE INDEX IF NOT EXISTS fin_activity_at_idx ON fin_activity (at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS fin_activity_ym_idx ON fin_activity (ym)`;
    const [c] = await sql<{ n: string }[]>`SELECT count(*)::text n FROM fin_activity`;
    console.log(`✅ fin_activity 준비됨 (지금 ${c.n}줄)`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
