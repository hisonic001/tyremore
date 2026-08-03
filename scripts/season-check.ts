/**
 * 계절 분류가 어떻게 바뀌는지 **모델 이름까지** 보여준다. DB 는 건드리지 않는다.
 *
 * `tire-attrs.ts` 의 사전을 고친 뒤 이걸로 먼저 눈으로 확인하고,
 * 괜찮으면 `npx tsx scripts/backfill-attrs.ts` 로 반영한다.
 * 계절이 틀린 타이어를 파는 것은 사고로 이어질 수 있어서 항상 사람이 본다.
 *
 *   npx tsx scripts/season-check.ts            바뀌는 것 전부 요약
 *   npx tsx scripts/season-check.ts 겨울        「→ 겨울」 갈래만 자세히
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const only = process.argv[2] ?? null;
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { parseTireAttrs } = await import("../src/lib/tire-attrs");
  const { parseTireName } = await import("../src/lib/tire-name");

  const rows = await db.execute<{
    brand: string;
    pattern: string | null;
    raw_name: string;
    season: string | null;
    stock: number;
    overridden: boolean;
  }>(sql`
    SELECT COALESCE(p.brand_code,'--') brand, p.pattern, p.raw_name, p.season,
           COALESCE((SELECT SUM(s.qty)::int FROM stock_item s
                     WHERE s.product_id=p.id AND s.status='재고'),0) stock,
           (p.attrs_override ? 'season') overridden
    FROM product p WHERE p.item_type='tire'
  `);

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const moves = new Map<string, { n: number; stock: number; models: Map<string, number> }>();

  for (const r of rows) {
    const b = r.season ?? "(미분류)";
    const a = parseTireAttrs(r.pattern, r.raw_name).season ?? "(미분류)";
    before.set(b, (before.get(b) ?? 0) + 1);
    after.set(a, (after.get(a) ?? 0) + 1);
    if (a === b) continue;
    const key = `${b} → ${a}`;
    const e = moves.get(key) ?? { n: 0, stock: 0, models: new Map() };
    e.n++;
    e.stock += Number(r.stock);
    const m = parseTireName(r.raw_name, r.pattern, {
      width: null, aspectRatio: null, rimInch: null, brandCode: r.brand,
    }).model.toUpperCase();
    const label = `[${r.brand}] ${m}`;
    e.models.set(label, (e.models.get(label) ?? 0) + 1);
    moves.set(key, e);
  }

  const fmt = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ·  ");
  console.log(`전  ${fmt(before)}`);
  console.log(`후  ${fmt(after)}\n`);

  const ov = rows.filter((r) => r.overridden).length;
  if (ov) console.log(`⚠️ 사장님이 직접 고친 계절 ${ov}건 — 재계산해도 그대로 둡니다\n`);

  for (const [key, e] of [...moves.entries()].sort((a, b) => b[1].n - a[1].n)) {
    if (only && !key.includes(only)) continue;
    console.log(`\n══ ${key}  ${e.n}건 (재고 ${e.stock}본)`);
    const list = [...e.models.entries()].sort((a, b) => b[1] - a[1]);
    for (const [m, n] of list.slice(0, only ? 200 : 25)) {
      console.log(`     ${String(n).padStart(4)}  ${m}`);
    }
    if (!only && list.length > 25) console.log(`     … 그 밖에 ${list.length - 25}종`);
  }
  process.exit(0);
}
main();
