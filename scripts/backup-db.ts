/**
 * ⭐ DB 백업 (2026-08-04)
 *
 * 재고 573본 · 고객 2,600여 명 · 판매·매입 기록이 든 운영 DB인데
 * **우리가 통제하는 백업이 하나도 없었다.** D-06 은 "이관 = DB 덤프"라고
 * 약속해 놓고 덤프 스크립트가 없었다. 실수 한 번이면 끝이었다.
 *
 * 이 PC 에는 pg_dump 가 없어서 노드로 직접 받는다 — 표마다 NDJSON 한 파일.
 * 사람이 열어 읽을 수 있고, 복구는 `restore-db.ts` 가 한다.
 *
 *   npx tsx scripts/backup-db.ts            → C:/dev/tyremore-data/backup/2026-08-04_1430/
 *   npm run db:backup                        (같은 것)
 *
 * ⚠️ 백업은 저장소(`tyremore-data`) **밖으로 내보내지 않는다** — 고객 실명·전화가 들어 있다.
 * 오래된 백업은 14개까지만 남기고 지운다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const KEEP = 14;
const ROOT = process.env.BACKUP_DIR ?? "C:/dev/tyremore-data/backup";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const started = Date.now();
  try {
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    const dir = path.join(ROOT, stamp);
    mkdirSync(dir, { recursive: true });

    // public 스키마의 모든 표 — 새 표가 생겨도 자동으로 포함된다
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`;

    const manifest: Record<string, number> = {};
    for (const { table_name: t } of tables) {
      const rows = await sql`SELECT * FROM ${sql(t)}`;
      const lines = rows.map((r) => JSON.stringify(r)).join("\n");
      writeFileSync(path.join(dir, `${t}.ndjson`), lines, "utf-8");
      manifest[t] = rows.length;
      console.log(`  ${t.padEnd(24)} ${String(rows.length).padStart(6)}줄`);
    }
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ at: d.toISOString(), tables: manifest }, null, 2),
      "utf-8",
    );

    // 오래된 백업 정리 — 이름이 날짜라 정렬이 곧 시간순이다
    const olds = readdirSync(ROOT)
      .filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n))
      .sort()
      .slice(0, -KEEP);
    for (const o of olds) rmSync(path.join(ROOT, o), { recursive: true, force: true });

    const total = Object.values(manifest).reduce((s, n) => s + n, 0);
    console.log(`\n✅ ${dir}`);
    console.log(`   표 ${tables.length}개 · ${total.toLocaleString()}줄 · ${((Date.now() - started) / 1000).toFixed(1)}초`);
    if (olds.length) console.log(`   오래된 백업 ${olds.length}개 정리 (최근 ${KEEP}개 유지)`);
    if (!existsSync(path.join(dir, "product.ndjson"))) {
      console.error("⚠️ product 표가 백업에 없습니다 — 무언가 잘못됐습니다");
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("백업 실패:", e);
  process.exit(1);
});
