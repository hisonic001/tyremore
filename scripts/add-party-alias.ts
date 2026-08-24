/**
 * ERP 보강 — 이름 별명 사전 (사장님 요청 2026-08-24)
 *
 *   "세금계산서 상의 거래처 이름과 입금내역의 거래처 이름이 다르거나
 *    앱에 기록한 이름이 다를 수 있는데 이 부분을 개선했으면 좋겠음."
 *
 *   미쉐린코리아(주) ↔ 미쉐린, 문성환 ↔ 수도공무소 처럼 같은 상대가 자료마다
 *   다른 이름으로 온다. 사장님이 한 번 이어 주면 그 이름을 기억해
 *   다음부터는 후보 맨 위(높은 확신)로 올린다 — supplier_item_code 학습 사전 철학.
 *
 *   npx tsx scripts/add-party-alias.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS party_alias (
        id          bigserial PRIMARY KEY,
        alias_key   text NOT NULL UNIQUE,  -- 정규화된 외부 이름 (공백·㈜ 등 제거, 소문자)
        alias_raw   text NOT NULL,         -- 원문 보존
        party_key   text NOT NULL,         -- 'S:미쉐린' (거래처) · 'C:123' (고객)
        party_label text NOT NULL,         -- 화면 표시용
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`;
    console.log("✅ party_alias 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
