/**
 * supplier_item_code 테이블 만들기 (2026-08-04)
 *
 * 거래처마다 같은 타이어를 다른 품번으로 부른다.
 *   금호 자재코드 2387392  ←→  우리(MARS) 품번 KM2284552
 * 그 짝을 적어 두는 사전이다. 자세한 것은 `src/db/schema.ts` 주석 참조.
 *
 *   npx tsx scripts/add-supplier-item-code.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS supplier_item_code (
        id            bigserial PRIMARY KEY,
        supplier      text NOT NULL,
        code          text NOT NULL,
        product_id    bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        supplier_name text,
        matched_by    text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_item_code ON supplier_item_code (supplier, code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_supplier_item_product ON supplier_item_code (product_id)`;

    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM supplier_item_code`;
    console.log(`✅ supplier_item_code 준비됨 — 지금 ${n}건`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
