/**
 * 「타이어 나이」 확인 — 선입선출·입고일 표시 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/check-tire-age-20260827.ts
 *
 * 고치는 스크립트가 아니라 **재는** 스크립트다. 배포 뒤에 다시 돌리면 그대로인지 보인다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ageAnchorSql, ageBadge, dotLabel, dotToDate, oldByDotSql, receivedLabel, staleNoDotSql } from "@/lib/tire-age";

const A = ageAnchorSql("s.dot", "s.received_at");

async function main() {
  /* ① 순서가 뒤집혔던 세 품목이 바로잡혔는가 */
  console.log("── ① 선입선출 순서 (전에 뒤집혀 있던 3품목) ──");
  for (const pid of [77, 1536, 2076]) {
    const rows = await db.execute<{ dot: string | null; recv: string; anchor: string; n: number }>(sql`
      SELECT s.dot, to_char(MIN(s.received_at) AT TIME ZONE 'Asia/Seoul','YY-MM-DD') recv,
             ${sql.raw(`MIN(${A})::text`)} anchor, count(*)::int n
      FROM stock_item s WHERE s.product_id = ${pid} AND s.status='재고'
      GROUP BY s.dot ORDER BY ${sql.raw(`MIN(${A})`)}`);
    const [p] = await db.execute<{ nm: string }>(sql`
      SELECT COALESCE(display_name, pattern) nm FROM product WHERE id = ${pid}`);
    console.log(`  #${pid} ${p?.nm}`);
    for (const r of rows)
      console.log(`     ${r.dot ?? "DOT없음"}  ${r.dot ? dotLabel(r.dot) : "".padEnd(8)}  기준 ${r.anchor}  ${r.n}본  (${r.recv} 입고)`);
  }

  /* ② 아직도 순서가 뒤집힌 품목이 남았는가 — 0이어야 한다 */
  const flipped = await db.execute<{ id: number; nm: string }>(sql`
    WITH g AS (
      SELECT s.product_id pid, s.dot, ${sql.raw(`MIN(${A})`)} anchor
      FROM stock_item s WHERE s.status='재고' GROUP BY s.product_id, s.dot
    ), o AS (
      SELECT pid,
             string_agg(COALESCE(dot,'-'), ',' ORDER BY dot NULLS FIRST) 옛순서,
             string_agg(COALESCE(dot,'-'), ',' ORDER BY anchor)          새순서
      FROM g GROUP BY pid HAVING count(*) > 1
    )
    SELECT p.id, COALESCE(p.display_name,p.pattern) nm FROM o JOIN product p ON p.id=o.pid
    WHERE o.옛순서 <> o.새순서 ORDER BY 1`);
  console.log(`\n── ② 옛 순서와 새 순서가 다른 품목 ${flipped.length}개 (전에 잘못 나가고 있던 것들) ──`);
  for (const f of flipped) console.log(`  #${f.id} ${f.nm}`);

  /* ③ 화면에 찍힐 값 표본 */
  console.log("\n── ③ 재고 상세에 찍힐 모습 (표본) ──");
  const sample = await db.execute<{
    id: number; nm: string; dot: string | null; first_in: Date; last_in: Date; n: number;
  }>(sql`
    SELECT p.id, COALESCE(p.display_name,p.pattern) nm, s.dot,
           MIN(s.received_at) first_in, MAX(s.received_at) last_in, count(*)::int n
    FROM stock_item s JOIN product p ON p.id=s.product_id
    WHERE s.status='재고' AND p.item_type='tire'
    GROUP BY 1,2,3 ORDER BY ${sql.raw(`MIN(${A})`)} LIMIT 8`);
  for (const r of sample) {
    const b = ageBadge(r.dot, r.first_in);
    console.log(
      `  #${r.id} ${(r.nm ?? "").slice(0, 24).padEnd(24)} ` +
        `${(r.dot ?? "DOT없음").padEnd(7)} ${(r.dot ? dotLabel(r.dot) : "").padEnd(9)} ` +
        `${receivedLabel(r.first_in, r.last_in).padEnd(14)} ${r.n}본` +
        (b ? `  [${b.text} · ${b.tone}]` : ""),
    );
  }

  /* ④ /stock 요약 배지 */
  const [s] = await db.execute<{ qty: number; old: number; nodot: number; stale: number }>(sql`
    SELECT COALESCE(SUM(s.qty),0)::int qty,
           COALESCE(SUM(s.qty) FILTER (WHERE ${sql.raw(oldByDotSql("s.dot"))}),0)::int old,
           COALESCE(SUM(s.qty) FILTER (WHERE s.dot IS NULL),0)::int nodot,
           COALESCE(SUM(s.qty) FILTER (WHERE ${sql.raw(staleNoDotSql("s.dot", "s.received_at"))}),0)::int stale
    FROM stock_item s JOIN product p ON p.id=s.product_id
    WHERE s.status='재고' AND s.qty>0 AND p.item_type='tire'`);
  console.log(`\n── ④ /stock 요약 ──\n  재고 ${s.qty}본 · 제조 2년 넘음 ${s.old}본 · DOT 없음 ${s.nodot}본 · DOT 없이 1년 넘음 ${s.stale}본`);

  /* ⑤ 말이 안 되는 DOT 이 있는가 — 있으면 입고일로 대신 세워진다 */
  const weird = await db.execute<{ dot: string; n: number }>(sql`
    SELECT s.dot, count(*)::int n FROM stock_item s
    WHERE s.status='재고' AND s.dot IS NOT NULL AND ${sql.raw(`${A} = (s.received_at AT TIME ZONE 'Asia/Seoul')::date`)}
    GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`\n── ⑤ DOT 가 있는데 못 믿어 입고일로 세운 것 ${weird.length}가지 ──`);
  for (const w of weird) console.log(`  ${w.dot} — ${w.n}본`);

  /* ⑥ 코드 쪽 계산이 SQL 과 같은 답을 내는가 */
  console.log("\n── ⑥ 코드 ↔ SQL 같은 답을 내는가 ──");
  const cmp = await db.execute<{ dot: string; sqlv: string }>(sql`
    SELECT DISTINCT s.dot, ${sql.raw(`${A}::text`)} sqlv FROM stock_item s
    WHERE s.status='재고' AND s.dot IS NOT NULL LIMIT 200`);
  let same = 0, diff = 0;
  for (const c of cmp) {
    const js = dotToDate(c.dot);
    const jsv = js ? js.toISOString().slice(0, 10) : null;
    if (jsv === c.sqlv) same++;
    else { diff++; console.log(`  ✖ ${c.dot} — SQL ${c.sqlv} · 코드 ${jsv}`); }
  }
  console.log(`  같음 ${same} · 다름 ${diff} (0이어야 한다)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
