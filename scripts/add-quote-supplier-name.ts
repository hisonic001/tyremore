/**
 * quote.supplier_name 추가 (2026-08-17)
 *
 * 🔴 왜 컬럼을 새로 만드나 — 거래처 이름이 지금은 `mars_memo` 글자에만 있다
 *    (`거래처 금호`). 그런데 그 칸은 MARS 기능들이 덮어쓴다:
 *      · mars-queue.ts markEntered·holdMars → marsMemo 를 **통째로 대체**
 *      · sale-edit.ts marsMismatchNote → `거래처 금호 · 수정됨 — …` 로 오염
 *    지금은 거래처 건이 '해당없음' 이라 대기열에 안 들어가 우연히 안전할 뿐인데,
 *    이번에 만드는 「손님·거래처 바꾸기」가 그 우연을 깬다 (거래처↔개인을 오가면
 *    대기열에 들어갔다 나온다). 게다가 오염된 글자로 묶으면 외상 장부에서
 *    「금호」와 「금호 · 수정됨…」이 **두 거래처로 갈린다.**
 *
 * ⚠️ supplier 표에 외래키로 묶지 않는다 — purchase_invoice.supplier 와 같은 이유.
 *    대신 거래처 이름을 바꾸면 여기도 같이 바꾼다 (src/lib/supplier.ts).
 *
 * 실행: npx tsx scripts/add-quote-supplier-name.ts (다시 돌려도 안전)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`ALTER TABLE quote ADD COLUMN IF NOT EXISTS supplier_name text`;

    /**
     * 백필 — 「거래처 금호」·「거래처 금호 · 수정됨…」 둘 다 '금호' 로.
     * substring(… from 5) 는 앞의 「거래처 」(4글자+공백=5)를 떼는 것이고,
     * split_part(…, '·', 1) 로 뒤에 덧붙은 메모를 잘라낸다.
     * supplier 표에 같은 이름이 있으면 **그 정식 이름으로 스냅**한다 —
     * 「쌍성」과 「쌍성 타이어」가 두 거래처로 갈리지 않게.
     */
    const filled = await sql`
      UPDATE quote q SET supplier_name = COALESCE(s.name, x.raw)
      FROM (
        SELECT id, btrim(split_part(substring(mars_memo from 5), '·', 1)) raw
        FROM quote WHERE mars_memo LIKE '거래처 %'
      ) x
      LEFT JOIN supplier s ON s.name_key = replace(lower(x.raw), ' ', '')
      WHERE q.id = x.id AND q.supplier_name IS NULL AND x.raw <> ''
      RETURNING q.id
    `;
    console.log(`백필 ${filled.length}건`);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_quote_supplier ON quote (supplier_name)
      WHERE supplier_name IS NOT NULL
    `;

    // ── 검증: memo 에 거래처인데 컬럼이 빈 건이 하나도 없어야 한다
    const [chk] = await sql<{ memo_n: number; col_n: number; missed: number }[]>`
      SELECT count(*) FILTER (WHERE mars_memo LIKE '거래처 %')::int memo_n,
             count(*) FILTER (WHERE supplier_name IS NOT NULL)::int col_n,
             count(*) FILTER (WHERE mars_memo LIKE '거래처 %' AND supplier_name IS NULL)::int missed
      FROM quote
    `;
    console.log(`메모 기준 ${chk.memo_n}건 · 컬럼 채워진 것 ${chk.col_n}건 · 놓친 것 ${chk.missed}건`);
    if (chk.missed > 0) console.log("⚠️ 놓친 건이 있습니다 — 확인이 필요합니다");

    // 거래처 이름 목록 — supplier 표와 눈으로 대조해 오타로 갈린 것을 잡는다
    const names = await sql<{ nm: string; n: number }[]>`
      SELECT supplier_name nm, count(*)::int n FROM quote
      WHERE supplier_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30
    `;
    console.log("\n판매에 쓰인 거래처:");
    for (const r of names) console.log(`  ${r.nm.padEnd(24)} ${r.n}건`);

    const reg = await sql<{ name: string }[]>`SELECT name FROM supplier ORDER BY name`;
    const known = new Set(reg.map((r) => r.name.replace(/\s/g, "").toLowerCase()));
    const strays = names.filter((r) => !known.has(r.nm.replace(/\s/g, "").toLowerCase()));
    if (strays.length) {
      console.log("\n⚠️ 거래처 표에 없는 이름 (설정>거래처에서 추가하거나 이름을 맞춰 주세요):");
      for (const r of strays) console.log(`  ${r.nm} (${r.n}건)`);
    }

    console.log("\n✅ quote.supplier_name 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
