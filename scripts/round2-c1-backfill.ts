/**
 * ⭐ 2회차 수리 C1 — 카드사 수수료 환급 입금을 「카드정산」으로 모으기 (2026-08-28)
 *
 *   왜: 같은 성격의 입금이 적요 머리표에 따라 「카드정산」과 「기타입금」으로 갈려 있었다.
 *       규칙(expense-cats.CARD_SETTLE_PATTERN_SQL)은 이미 고쳤지만, 자동 분류는
 *       `category IS NULL` 인 줄만 건드리므로 **이미 붙어 있는 것은 안 바뀐다.**
 *       그래서 한 번만 손으로 옮긴다.
 *
 *   사장님 결정(2026-08-28): 「카드정산」으로 통일.
 *
 *   🔴 되돌릴 수 있다. 바꾸기 전에 바꾼 줄을 통째로 백업 파일에 적는다.
 *
 *     미리보기 (아무것도 안 바꿈):  npx tsx scripts/round2-c1-backfill.ts
 *     실제 반영:                   npx tsx scripts/round2-c1-backfill.ts --apply
 *     되돌리기:                    npx tsx scripts/round2-c1-backfill.ts --revert
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

const BACKUP_DIR = fs.existsSync("C:/dev/tyremore-data")
  ? "C:/dev/tyremore-data/backup"
  : path.join(process.cwd(), ".backup");
const BACKUP = path.join(BACKUP_DIR, "round2-c1-card-refund.json");
const won = (n: number) => n.toLocaleString("ko-KR");

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--revert") ? "revert" : "preview";
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { CARD_SETTLE_PATTERN_SQL } = await import("../src/lib/expense-cats");

  if (mode === "revert") {
    if (!fs.existsSync(BACKUP)) {
      console.log(`\n  되돌릴 백업이 없습니다: ${BACKUP}\n`);
      process.exit(1);
    }
    const rows: { id: number; category: string | null }[] = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
    console.log(`\n── 되돌리기 (${rows.length}건) ──\n`);
    await db.transaction(async (tx) => {
      for (const r of rows) {
        await tx.execute(sql`UPDATE cash_txn SET category = ${r.category} WHERE id = ${r.id}`);
        console.log(`  ← id ${r.id} 를 「${r.category ?? "분류 없음"}」 으로 되돌림`);
      }
    });
    fs.renameSync(BACKUP, BACKUP + ".used");
    console.log(`\n  되돌렸습니다. 백업은 ${BACKUP}.used 로 옮겼습니다.\n`);
    process.exit(0);
  }

  /* 대상: 새 규칙에 걸리는 **입금**인데 아직 카드정산이 아닌 것 */
  const targets = await db.execute<{
    id: number; d: string; description: string; in_amount: number; category: string | null;
  }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
           description, in_amount, category
    FROM cash_txn
    WHERE is_active AND source = '통장' AND in_amount > 0
      AND COALESCE(category, '') <> '카드정산'
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
    ORDER BY occurred_at
  `);

  console.log(`\n── 카드사 수수료 환급 → 카드정산 (${mode === "apply" ? "반영" : "미리보기"}) ──\n`);
  if (targets.length === 0) {
    console.log("  옮길 것이 없습니다 — 이미 다 맞습니다.\n");
    process.exit(0);
  }
  for (const t of targets) {
    console.log(`  ${t.d}  ${t.description.padEnd(24)} ${won(Number(t.in_amount)).padStart(10)}원  「${t.category ?? "분류 없음"}」 → 「카드정산」`);
  }
  console.log(`\n  모두 ${targets.length}건 · ${won(targets.reduce((s, t) => s + Number(t.in_amount), 0))}원`);

  if (mode !== "apply") {
    console.log(`\n  🔴 아직 아무것도 안 바꿨습니다. 반영하려면:  npx tsx scripts/round2-c1-backfill.ts --apply\n`);
    process.exit(0);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(BACKUP, JSON.stringify(targets.map((t) => ({ id: Number(t.id), category: t.category })), null, 1));
  console.log(`\n  백업 저장: ${BACKUP}`);

  await db.transaction(async (tx) => {
    for (const t of targets) {
      await tx.execute(sql`UPDATE cash_txn SET category = '카드정산' WHERE id = ${t.id}`);
    }
  });
  console.log(`  ${targets.length}건 반영했습니다.`);
  console.log(`  되돌리려면:  npx tsx scripts/round2-c1-backfill.ts --revert\n`);
  process.exit(0);
}
main();
