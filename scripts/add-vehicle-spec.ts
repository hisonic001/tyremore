/**
 * 차종별 순정 제원 (D-04 3차 개정, 2026-09-03) — 표 만들기
 *
 * 🔴 값보다 **근거가 먼저**다. `spec_source`(우리가 직접 받아 온 원문)와
 *    `spec_citation`(원문 어디에서 나왔나) 없이는 값이 존재할 수 없는 구조다.
 *    이 저장소의 `kumho_material.source_label`·`continental_material.source_label` 과 같은 태도다.
 *
 *   npx tsx scripts/add-vehicle-spec.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    /* ① 차종 — 기아 쏘렌토 */
    await sql`
      CREATE TABLE IF NOT EXISTS vehicle_model (
        id         bigserial PRIMARY KEY,
        maker_code text NOT NULL REFERENCES vehicle_maker(code),
        name_ko    text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (maker_code, name_ko)
      )`;

    /**
     * ② 세대·변형 — 제원의 실제 주인. 취급설명서 한 권이 대개 이 한 줄이다.
     *    🔴 variant_key 는 사장님이 이미 괄호에 쓰시던 글자를 그대로 쓴다 (MQ4 · MQ4-HEV).
     *       제조사 취급설명서 주소의 projCode 와 같은 글자라 근거를 바로 찾을 수 있다.
     */
    await sql`
      CREATE TABLE IF NOT EXISTS vehicle_generation (
        id          bigserial PRIMARY KEY,
        model_id    bigint NOT NULL REFERENCES vehicle_model(id),
        variant_key text NOT NULL UNIQUE,
        proj_code   text,
        phase       text,
        powertrain  text,
        year_from   integer,
        year_to     integer,
        label       text NOT NULL,
        body_type   text,
        manual_url  text,
        note        text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vg_phase CHECK (phase IS NULL OR phase IN ('초기형','페이스리프트','2차 페이스리프트')),
        CONSTRAINT vg_pt    CHECK (powertrain IS NULL OR powertrain IN ('가솔린','디젤','LPG','하이브리드','PHEV','전기','수소'))
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vg_model ON vehicle_generation (model_id, year_from)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vg_proj  ON vehicle_generation (proj_code)`;

    /**
     * ③ 별칭 — vehicle.model 자유 텍스트 548종을 흡수 (vehicle_maker_alias 와 같은 방식)
     * 🔴 연식 없이 세대를 못 정하는 것(그냥 '쏘렌토' 45대)은 generation_id 를 NULL 로 둔다.
     *    억지로 채우면 그 순간 45대가 전부 틀린 제원을 갖는다.
     */
    await sql`
      CREATE TABLE IF NOT EXISTS vehicle_model_alias (
        raw_model     text PRIMARY KEY,
        model_id      bigint REFERENCES vehicle_model(id),
        generation_id bigint REFERENCES vehicle_generation(id),
        matched_by    text,
        created_at    timestamptz NOT NULL DEFAULT now()
      )`;

    /** ④ 근거 — 우리가 직접 받아 온 원문. 이게 없으면 검증이 성립하지 않는다 */
    await sql`
      CREATE TABLE IF NOT EXISTS spec_source (
        id            bigserial PRIMARY KEY,
        generation_id bigint REFERENCES vehicle_generation(id),
        url           text NOT NULL,
        host          text NOT NULL,
        title         text,
        kind          text NOT NULL,
        trust_rank    integer NOT NULL,
        independence_key text NOT NULL,
        fetched_at    timestamptz NOT NULL DEFAULT now(),
        -- 🔴 같은 날 같은 주소를 두 번 긁지 않기 위한 칸.
        --    fetched_at::date 는 시간대에 따라 달라져 인덱스로 못 쓴다 (Postgres 42P17)
        fetched_on    date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
        http_status   integer,
        content_sha256 text,
        body_text     text NOT NULL,
        requested_by  bigint NOT NULL REFERENCES app_user(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ss_rank CHECK (trust_rank BETWEEN 1 AND 5)
      )`;
    /* 표가 먼저 만들어진 뒤 칸이 늘어난 경우도 안전하게 (다시 돌려도 된다) */
    await sql`ALTER TABLE spec_source ADD COLUMN IF NOT EXISTS fetched_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_spec_source_gen ON spec_source (generation_id)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_spec_source_url_day ON spec_source (url, fetched_on)`;

    /** ⑤ 값 */
    await sql`
      CREATE TABLE IF NOT EXISTS vehicle_spec (
        id            bigserial PRIMARY KEY,
        generation_id bigint NOT NULL REFERENCES vehicle_generation(id),
        group_no      integer NOT NULL DEFAULT 1,
        group_label   text,
        item          text NOT NULL,
        qualifier     jsonb,
        num_min       numeric(10,3),
        num_max       numeric(10,3),
        unit          text,
        text_value    text,
        status        text NOT NULL DEFAULT '검수대기',
        risk          text NOT NULL DEFAULT '보통',
        conflict      boolean NOT NULL DEFAULT false,
        verified_by   bigint REFERENCES app_user(id),
        verified_at   timestamptz,
        verify_note   text,
        created_by    text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT vs_status CHECK (status IN ('검수대기','승인','보류','거절')),
        CONSTRAINT vs_risk   CHECK (risk IN ('높음','보통','낮음')),
        CONSTRAINT vs_value  CHECK (num_min IS NOT NULL OR text_value IS NOT NULL),
        CONSTRAINT vs_range  CHECK (num_max IS NULL OR num_min IS NULL OR num_max >= num_min),
        CONSTRAINT vs_verified CHECK (status <> '승인' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vehicle_spec_gen  ON vehicle_spec (generation_id, item)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vehicle_spec_wait ON vehicle_spec (status) WHERE status = '검수대기'`;

    /** ⑥ 인용 — 🔴 이 표가 이 설계의 심장이다. 인용 없이 값이 존재할 수 없다 */
    await sql`
      CREATE TABLE IF NOT EXISTS spec_citation (
        id         bigserial PRIMARY KEY,
        spec_id    bigint NOT NULL REFERENCES vehicle_spec(id) ON DELETE CASCADE,
        source_id  bigint NOT NULL REFERENCES spec_source(id),
        quote      text NOT NULL,
        quote_pos  integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (spec_id, source_id)
      )`;

    /** ⑦ 차량 → 세대 (자유 텍스트는 그대로 두고 코드 칸 하나만 옆에 붙인다) */
    await sql`ALTER TABLE vehicle ADD COLUMN IF NOT EXISTS generation_id bigint REFERENCES vehicle_generation(id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vehicle_generation ON vehicle (generation_id)`;

    /** ⑧ 매장 PC 주문표에 종류 하나 (표를 새로 만들지 않는다) */
    await sql`ALTER TABLE blog_job DROP CONSTRAINT IF EXISTS blog_job_kind`;
    await sql`ALTER TABLE blog_job ADD CONSTRAINT blog_job_kind CHECK (kind IN ('초안','스캔','정리','제원'))`;

    console.log("✅ 표 6개 + vehicle.generation_id + blog_job kind '제원' 준비됨");
    const [c] = await sql`SELECT count(*)::int n FROM vehicle_model`;
    console.log(`   지금 차종 ${c.n}종`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
