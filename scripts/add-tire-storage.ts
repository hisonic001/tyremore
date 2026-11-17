/**
 * ⭐ 타이어 보관 (D-42, 사장님 착수 지시 2026-11-17)
 *
 *   손님이 맡긴 타이어 한 세트 = 한 줄. 보관번호(0001…)가 곧 창고 자리다 — 번호 순서로 쌓는다.
 *   🔴 손님 타이어는 stock_item(매장 재고)에 넣지 않는다 — 섞이면 남의 타이어를 팔 수 있다.
 *
 *   status: 확인대기(실사 후보, 번호 없음) · 보관중 · 찾아감 · 폐기 · 제외(잘못 등록·판매 취소·실사 없음)
 *   보관번호는 재사용하지 않는다. 확인대기·제외(번호 받기 전)는 번호가 비어 있다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-tire-storage.ts   (멱등 — 두 번 돌려도 같다)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tire_storage (
      id bigserial PRIMARY KEY,
      storage_no integer UNIQUE,
      status text NOT NULL DEFAULT '보관중',
      customer_id bigint NOT NULL REFERENCES customer(id),
      vehicle_id bigint REFERENCES vehicle(id),
      kind text,
      brand text,
      size text,
      qty integer NOT NULL DEFAULT 4,
      dot text,
      memo text,
      stored_on date NOT NULL,
      stored_quote_id bigint REFERENCES quote(id),
      released_on date,
      released_quote_id bigint REFERENCES quote(id),
      release_note text,
      source_text text,
      created_by bigint REFERENCES app_user(id),
      released_by bigint REFERENCES app_user(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT tire_storage_status CHECK (status IN ('확인대기','보관중','찾아감','폐기','제외')),
      CONSTRAINT tire_storage_kind CHECK (kind IS NULL OR kind IN ('스노','일반')),
      CONSTRAINT tire_storage_kind_needed CHECK (kind IS NOT NULL OR status IN ('확인대기','제외')),
      CONSTRAINT tire_storage_no_needed CHECK (storage_no IS NOT NULL OR status IN ('확인대기','제외')),
      CONSTRAINT tire_storage_qty CHECK (qty BETWEEN 1 AND 8)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_customer ON tire_storage (customer_id) WHERE status = '보관중'`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_vehicle ON tire_storage (vehicle_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_stored_quote ON tire_storage (stored_quote_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_released_quote ON tire_storage (released_quote_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_status ON tire_storage (status, storage_no)`);

  const rows = await db.execute<{ status: string; n: number }>(
    sql`SELECT status, count(*)::int n FROM tire_storage GROUP BY 1 ORDER BY 1`,
  );
  console.log(`tire_storage 준비됨 — ${rows.map((r) => `${r.status} ${r.n}`).join(" · ") || "비어 있음"}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
