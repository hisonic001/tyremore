/**
 * ⭐ 수금 수단 「개인계좌」 — 제약 점검·수리 (2026-09-10)
 *
 *   `COLLECT_METHODS`(lib/payments.ts) 에는 「개인계좌」가 있는데 DB 의
 *   `receivable_payment_method_check` 에는 없을 수 있다. 목록만 늘고 제약이
 *   안 따라오면, 앱은 「개인계좌」를 고르게 해 놓고 저장할 때 23514 로 튕긴다 —
 *   사장님 눈에는 「수금이 안 눌린다」로만 보인다.
 *
 *   판매 등록의 결제 통일(2026-09-10)로 **받은 몫이 receivable_payment 로 들어가는
 *   길이 넓어졌다**(본사청구·예약 잔금). 그래서 이 틈을 먼저 막아 둔다.
 *
 * 🔴 새로 만드는 제약이 아니다 — 정본은 scripts/add-collect-personal.ts (2026-09-07).
 *    이 스크립트는 **그게 이 DB 에 실제로 적용됐는지 확인하고, 아니면 채운다**.
 *    둘 다 멱등이라 몇 번 돌려도 같다.
 *
 * ⚠️ db/schema.ts 의 `receivable_payment_method_check` 에도 「개인계좌」를 넣어야
 *    선언과 실물이 갈라지지 않는다 (그 파일은 다른 갈래가 들고 있다 — 주 세션 확인).
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-collect-personal-fix.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** 수금 표에 들어갈 수 있는 수단 — lib/payments.ts 의 COLLECT_METHODS 와 한 벌 */
const METHODS = ["현금", "카드", "계좌이체", "지역화폐", "간편결제", "개인계좌"];

async function main() {
  const [before] = await db.execute<{ def: string | null }>(sql`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conname = 'receivable_payment_method_check'
  `);
  const missing = METHODS.filter((m) => !(before?.def ?? "").includes(m));
  if (before?.def && missing.length === 0) {
    console.log("이미 맞습니다 — 손대지 않았습니다\n ", before.def);
    process.exit(0);
  }
  console.log(before?.def ? `빠진 수단: ${missing.join(", ")}` : "제약이 아예 없습니다 — 새로 겁니다");

  /* 🔴 제약을 걸기 전에 지금 자료가 그 안에 드는지 먼저 본다 — 밖에 있는 값이 있으면
     ADD CONSTRAINT 자체가 실패한다. 무엇이 걸리는지 먼저 알려 주고 멈춘다 */
  const stray = await db.execute<{ method: string; n: number }>(sql`
    SELECT method, count(*)::int n FROM receivable_payment
    WHERE method <> ALL(${sql.raw(`ARRAY[${METHODS.map((m) => `'${m}'`).join(",")}]`)})
    GROUP BY 1 ORDER BY 2 DESC
  `);
  if (stray.length > 0) {
    console.log("⚠️ 목록 밖 수단이 이미 저장돼 있습니다 — 제약을 걸 수 없습니다:");
    for (const r of stray) console.log(`   · ${r.method} ${r.n}건`);
    process.exit(1);
  }

  await db.execute(sql`ALTER TABLE receivable_payment DROP CONSTRAINT IF EXISTS receivable_payment_method_check`);
  await db.execute(
    sql`ALTER TABLE receivable_payment ADD CONSTRAINT receivable_payment_method_check
        CHECK (method IN (${sql.raw(METHODS.map((m) => `'${m}'`).join(","))}))`,
  );
  const [after] = await db.execute<{ def: string }>(sql`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conname = 'receivable_payment_method_check'
  `);
  console.log("제약 갱신됨 —", after?.def);
  process.exit(0);
}
main();
