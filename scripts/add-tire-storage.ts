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
import { defaultRoomPlan, defaultSitePlan, isLegacyDefaultRoom, sanitizePlan } from "@/lib/storage-plan-pure";

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

  /* ⭐ 2026-11-18 보강 — ① 어디서 왔나(origin) ② 위치(도면 위 점) */
  // ① 판매로 맡김(판매 취소 때 같이 되돌림) · 등록(손으로) · 실사(옛 메모·경리 명단 — 판매 취소와 무관)
  const [hadOrigin] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'tire_storage' AND column_name = 'origin'`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT '판매'`);
  if (Number(hadOrigin.n) === 0) {
    // 처음 한 번만 백필 — 실사 후보·경리 명단은 원문(source_text)이 있다, 손 등록은 판매도 원문도 없다
    await db.execute(sql`UPDATE tire_storage SET origin = '실사' WHERE source_text IS NOT NULL`);
    await db.execute(sql`UPDATE tire_storage SET origin = '등록' WHERE source_text IS NULL AND stored_quote_id IS NULL`);
  }
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE tire_storage ADD CONSTRAINT tire_storage_origin CHECK (origin IN ('판매','등록','실사'));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // ② 구역(도면) — 배치도 한 줄(is_site) + 구역마다 한 줄. 도면은 칸(사각형) 목록, 배경 사진은 선택
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS storage_area (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      is_site boolean NOT NULL DEFAULT false,
      plan jsonb NOT NULL,
      image text,
      sort integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS area_id bigint REFERENCES storage_area(id)`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS pin_x real`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS pin_y real`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_area ON tire_storage (area_id) WHERE status = '보관중'`);

  // 처음이면 기본 도면을 그려 둔다 (사장님 2026-11-18 — 「알아서 그려 주거나 내가 살짝 수정 가능하게」)
  const [areas] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM storage_area`);
  if (Number(areas.n) === 0) {
    const room = defaultRoomPlan();
    const floor = defaultRoomPlan({ stairs: true });
    const ids: number[] = [];
    for (const [i, [name, plan]] of (
      [
        ["벽돌 창고", room],
        ["흰색 창고", room],
        ["3층 건물 1층", floor],
        ["3층 건물 2층", floor],
        ["3층 건물 3층", floor],
      ] as const
    ).entries()) {
      const [r] = await db.execute<{ id: number }>(sql`
        INSERT INTO storage_area (name, plan, sort) VALUES (${name}, ${JSON.stringify(plan)}::jsonb, ${i + 1}) RETURNING id`);
      ids.push(Number(r.id));
    }
    const site = defaultSitePlan({ brick: ids[0], white: ids[1], floor1: ids[2], floor2: ids[3], floor3: ids[4] });
    await db.execute(sql`INSERT INTO storage_area (name, is_site, plan, sort) VALUES ('전체 배치도', true, ${JSON.stringify(site)}::jsonb, 0)`);
    console.log("기본 도면을 그렸습니다 — 배치도 1 · 구역 5");
  }

  /* ⭐ 3차 개정 (2026-11-18) — 점 대신 「자리(도면 칸 id) + 더미 번호」. pin_x/pin_y 는 더 안 쓴다(나중에 지움). */
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS slot_id text`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS stack_no smallint`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS located_at timestamptz`);
  await db.execute(sql`ALTER TABLE tire_storage ADD COLUMN IF NOT EXISTS located_by bigint REFERENCES app_user(id)`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE tire_storage ADD CONSTRAINT tire_storage_slot_area CHECK (slot_id IS NULL OR area_id IS NOT NULL);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE tire_storage ADD CONSTRAINT tire_storage_slot_stack CHECK ((slot_id IS NULL) = (stack_no IS NULL));
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE tire_storage ADD CONSTRAINT tire_storage_stack CHECK (stack_no IS NULL OR stack_no BETWEEN 1 AND 99);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tire_storage_slot ON tire_storage (area_id, slot_id, stack_no) WHERE status IN ('보관중','확인대기')`);

  // 1차 기본 도면(벽 셋+가운데)을 손 안 댔고 세트도 없으면 새 기본(자리 12개)으로 — 사장님이 고친 도면은 그대로
  const rooms = await db.execute<{ id: number; name: string; plan: unknown; n: number }>(sql`
    SELECT a.id, a.name, a.plan, (SELECT count(*)::int FROM tire_storage t WHERE t.area_id = a.id AND t.status IN ('보관중','확인대기')) AS n
    FROM storage_area a WHERE NOT a.is_site`);
  for (const r of rooms) {
    const { legacy, stairs } = isLegacyDefaultRoom(sanitizePlan(r.plan));
    if (!legacy) continue;
    if (Number(r.n) > 0) {
      console.log(`  ${r.name}: 1차 기본 도면이지만 세트가 있어 그대로`);
      continue;
    }
    await db.execute(sql`UPDATE storage_area SET plan = ${JSON.stringify(defaultRoomPlan({ stairs }))}::jsonb, updated_at = now() WHERE id = ${r.id}`);
    console.log(`  ${r.name}: 새 기본 도면(자리 12개)으로 바꿈`);
  }

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
