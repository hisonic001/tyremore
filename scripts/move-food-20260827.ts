/**
 * 「기타경비」에 섞여 있는 음식점을 「식대·접대」로 옮긴다 (사장님 지시 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/move-food-20260827.ts [--apply]
 *
 *   "식대 접대로 옮겨줘."
 *
 * 🔴 판정은 `readPayer().hint` 로 한다. `looksLikeFood` 를 직접 부르지 않는다 —
 *    그러면 `카페24트랜스코스모스코리아` 가 「카페」에 걸린다. `readPayer` 는
 *    **사전(KNOWN)을 먼저** 보므로 카페24·가비아 같은 것은 제 분류를 지킨다.
 *
 * 🔴 옮기기 전 상태를 `../tyremore-data/` 에 남긴다 — 되돌릴 수 있어야 한다.
 *    화면에서도 「분류된 지출 → 해제」로 한 건씩 되돌릴 수 있다.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readPayer } from "@/lib/payer-name";

const APPLY = process.argv.includes("--apply");
const CAT = "식대·접대";
const OUT = "../tyremore-data";

interface Row {
  [k: string]: unknown;
  id: number;
  source: string;
  description: string;
  out_amount: number;
  at: string;
  category: string;
}

async function main() {
  console.log(APPLY ? "■ 실제 반영" : "■ 미리보기 (--apply 를 붙여야 실제로 바뀝니다)\n");

  /* 「기타경비」로 붙어 있는 지출 전부 (통장·카드 둘 다) */
  const rows = await db.execute<Row>(sql`
    SELECT id, source, description, out_amount, category,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul','YY-MM-DD') at
    FROM cash_txn
    WHERE is_active AND out_amount > 0 AND category = '기타경비'
    ORDER BY occurred_at`);
  console.log(`「기타경비」 ${rows.length}건 검토\n`);

  const hit = rows.filter((r) => readPayer(r.source, r.description).hint === CAT);

  /* 상대별로 묶어 보여준다 — 사장님이 눈으로 훑기 좋게 */
  const byPayer = new Map<string, { n: number; s: number; ids: number[]; sample: string }>();
  for (const r of hit) {
    const p = readPayer(r.source, r.description);
    const g = byPayer.get(p.key) ?? { n: 0, s: 0, ids: [], sample: p.name };
    g.n += 1;
    g.s += Number(r.out_amount);
    g.ids.push(Number(r.id));
    byPayer.set(p.key, g);
  }

  const total = hit.reduce((s, r) => s + Number(r.out_amount), 0);
  console.log(`── 옮길 것: ${byPayer.size}상대 ${hit.length}건 ${total.toLocaleString()}원 ──`);
  for (const [key, g] of [...byPayer.entries()].sort((a, b) => b[1].s - a[1].s))
    console.log(`  ${String(g.s.toLocaleString()).padStart(10)}원 ${String(g.n).padStart(2)}건  ${g.sample}${g.sample !== key ? `  (열쇠: ${key})` : ""}`);

  /* 안 옮기는 것도 보여준다 — 빠뜨린 게 없는지 사장님이 확인하실 수 있게 */
  const rest = rows.filter((r) => !hit.includes(r));
  const restNames = new Map<string, number>();
  for (const r of rest) {
    const p = readPayer(r.source, r.description);
    restNames.set(p.name, (restNames.get(p.name) ?? 0) + Number(r.out_amount));
  }
  console.log(`\n── 「기타경비」에 그대로 두는 것: ${rest.length}건 ──`);
  for (const [n, s] of [...restNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
    console.log(`  ${String(s.toLocaleString()).padStart(10)}원  ${n}`);
  if (restNames.size > 30) console.log(`  … 그 밖 ${restNames.size - 30}상대`);

  if (!APPLY) {
    console.log("\n(미리보기라 여기서 멈춥니다)");
    process.exit(0);
  }
  if (hit.length === 0) {
    console.log("\n옮길 것이 없습니다.");
    process.exit(0);
  }

  /* 되돌릴 수 있게 옮기기 전 상태를 남긴다 */
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      `${OUT}/food-move-20260827.json`,
      JSON.stringify(hit.map((r) => ({ id: Number(r.id), was: r.category, at: r.at, desc: r.description })), null, 1),
      "utf8",
    );
    console.log(`\n옮기기 전 상태를 ${OUT}/food-move-20260827.json 에 남겼습니다`);
  } catch (e) {
    console.log(`\n⚠️ 백업 파일을 못 만들었습니다: ${String(e)}`);
  }

  const ids = hit.map((r) => Number(r.id));
  await db.execute(sql`
    UPDATE cash_txn SET category = ${CAT}
    WHERE id IN ${sql.raw(`(${ids.join(",")})`)}`);
  console.log(`✔ ${ids.length}건을 「${CAT}」로 옮겼습니다`);

  /* 앞으로도 같은 상대는 「식대·접대」로 붙게 규칙을 고친다 */
  for (const key of byPayer.keys()) {
    await db.execute(sql`
      INSERT INTO expense_rule (key, category) VALUES (${key}, ${CAT})
      ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, updated_at = now()`);
  }
  console.log(`✔ 규칙 ${byPayer.size}개를 「${CAT}」로 고쳤습니다 — 앞으로 올리는 파일에도 그렇게 붙습니다`);

  const sums = await db.execute<{ c: string; n: number; s: string }>(sql`
    SELECT category c, count(*)::int n, SUM(out_amount)::bigint s FROM cash_txn
    WHERE is_active AND out_amount > 0 AND category IN ('식대·접대','기타경비') GROUP BY 1 ORDER BY 3 DESC`);
  console.log("\n── 옮긴 뒤 ──");
  for (const r of sums) console.log(`  ${r.c.padEnd(10)} ${String(r.n).padStart(4)}건 ${Number(r.s).toLocaleString().padStart(12)}원`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
