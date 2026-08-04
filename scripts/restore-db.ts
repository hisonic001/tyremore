/**
 * 🔴 DB 복구 — 백업(`backup-db.ts`)에서 되살린다. **모든 데이터를 덮어쓴다.**
 *
 *   npx tsx scripts/restore-db.ts --dir "C:/dev/tyremore-data/backup/2026-08-04_1430" --dry
 *   npx tsx scripts/restore-db.ts --dir "..." --really-restore
 *
 * --dry 는 파일이 온전한지(줄 수·JSON 해석)만 확인한다. 기본은 --dry 다.
 * 실제 복구는 --really-restore 를 붙여야 하고, 지금 DB 내용은 사라진다.
 *
 * 표 순서는 외래키 방향을 따른다 (참조되는 쪽 먼저). 새 표를 만들면 여기에도 넣을 것.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** 외래키를 거스르지 않는 적재 순서 — 참조되는 표가 먼저 */
const ORDER = [
  "brand",
  "vehicle_maker",
  "vehicle_maker_alias",
  "app_user",
  "product",
  "product_barcode",
  "supplier",
  "supplier_item_code",
  "service_item",
  "price_rule",
  "customer",
  "vehicle",
  "quote",
  "quote_item",
  "stock_item",
  "stock_movement",
  "purchase_invoice",
  "purchase_invoice_item",
  "import_issue",
];

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--dir");
  const dir = at >= 0 ? argv[at + 1] : null;
  const really = argv.includes("--really-restore");
  if (!dir || !existsSync(dir)) {
    console.error('백업 폴더를 지정하세요: --dir "C:/dev/tyremore-data/backup/..."');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8")) as {
    at: string;
    tables: Record<string, number>;
  };
  console.log(`백업 시각: ${manifest.at}`);

  // 파일 검증 — 줄 수가 목록과 맞는지
  const data = new Map<string, Record<string, unknown>[]>();
  for (const [t, expect] of Object.entries(manifest.tables)) {
    const f = path.join(dir, `${t}.ndjson`);
    if (!existsSync(f)) {
      console.error(`  ❌ ${t}.ndjson 이 없습니다`);
      process.exit(1);
    }
    const raw = readFileSync(f, "utf-8");
    const rows = raw.trim() ? raw.trim().split("\n").map((l) => JSON.parse(l)) : [];
    if (rows.length !== expect) {
      console.error(`  ❌ ${t} — 목록에는 ${expect}줄인데 파일에는 ${rows.length}줄`);
      process.exit(1);
    }
    data.set(t, rows);
    console.log(`  ✓ ${t.padEnd(24)} ${String(rows.length).padStart(6)}줄`);
  }
  const unknown = Object.keys(manifest.tables).filter((t) => !ORDER.includes(t));
  if (unknown.length) console.log(`  ⚠️ 순서표에 없는 표 (마지막에 넣습니다): ${unknown.join(", ")}`);

  if (!really) {
    console.log("\n--dry 검증만 마쳤습니다. 실제 복구는 --really-restore 를 붙이세요 (지금 DB 가 사라집니다)");
    process.exit(0);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const order = [...ORDER.filter((t) => data.has(t)), ...unknown];
    // 역순으로 비운다 — 참조하는 쪽 먼저
    for (const t of [...order].reverse()) {
      await sql`TRUNCATE ${sql(t)} CASCADE`;
    }
    for (const t of order) {
      const rows = data.get(t)!;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        if (chunk.length) await sql`INSERT INTO ${sql(t)} ${sql(chunk)}`;
      }
      // 시퀀스를 최댓값 다음으로 — 안 맞추면 다음 INSERT 가 중복 id 로 터진다
      const [seq] = await sql<{ s: string | null }[]>`
        SELECT pg_get_serial_sequence(${t}, 'id') s`;
      if (seq?.s) {
        await sql`SELECT setval(${seq.s}, COALESCE((SELECT MAX(id) FROM ${sql(t)}), 0) + 1, false)`;
      }
      console.log(`  ↩ ${t} ${rows.length}줄`);
    }
    console.log("\n✅ 복구 완료");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("복구 실패:", e);
  process.exit(1);
});
