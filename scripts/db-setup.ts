/**
 * DB 최초 설정 — 확장 설치.
 *
 * pg_trgm 이 없으면 다음이 동작하지 않는다:
 *   · 고객 이름 부분검색 (customer.name_search)
 *   · 부품 적용차종 검색 (product.fitment) ← 부품 검색의 전부 (D-12)
 *
 * Supabase는 확장을 `extensions` 스키마에 두고, 인덱스를 만들 때 검색 경로에
 * 그 스키마가 없으면 "operator class gin_trgm_ops does not exist" 로 실패한다.
 *
 *   npx tsx scripts/db-setup.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;

    const [ext] = await sql<{ extname: string; extversion: string; nspname: string }[]>`
      SELECT e.extname, e.extversion, n.nspname
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_trgm'
    `;
    console.log(`pg_trgm ${ext?.extversion ?? "?"}  (스키마: ${ext?.nspname ?? "없음"})`);

    // 확장이 public 이 아닌 곳에 있으면 검색 경로에 넣어준다 (DB 단위로 영구 적용)
    if (ext && ext.nspname !== "public") {
      const [{ current_database: dbname }] = await sql<{ current_database: string }[]>`
        SELECT current_database()
      `;
      await sql.unsafe(
        `ALTER DATABASE "${dbname}" SET search_path TO public, ${ext.nspname}, "$user"`,
      );
      console.log(`search_path 에 ${ext.nspname} 추가 (DB: ${dbname})`);
    }

    const [{ search_path }] = await sql<{ search_path: string }[]>`SHOW search_path`;
    console.log(`현재 search_path: ${search_path}`);

    // 실제로 연산자 클래스가 보이는지 확인 (이게 되면 인덱스 생성이 된다)
    const [ok] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_opclass WHERE opcname = 'gin_trgm_ops'
    `;
    console.log(ok.n > 0 ? "✅ gin_trgm_ops 사용 가능" : "❌ gin_trgm_ops 없음");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
