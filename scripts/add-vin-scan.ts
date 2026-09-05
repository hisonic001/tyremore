/**
 * 사진으로 차량 정보 읽기 (2026-09-05, 사장님 제안)
 *
 * 🔴 이 기능의 값어치는 **차대번호 해독을 우회**하는 데 있다.
 *    17자리에서 차종을 알아내는 것은 불가능하다(4~9자리가 제작사만 아는 비공개 자료, 09-04).
 *    그런데 **B필러 차량 카드와 자동차등록증에는 차명이 그냥 적혀 있다** (사장님 지적).
 *    그러니 해독할 이유가 없다 — 적힌 것을 읽으면 된다.
 *
 * 🔴 사진은 읽고 나면 **즉시 지운다** (`image = NULL`). 창고에 남기지 않는다.
 *    등록증에는 소유자 이름·주소가 찍히기 때문이다.
 *
 * 코드 배포 **전에** 실행한다.
 *   npx tsx scripts/add-vin-scan.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS vin_scan (
        id           bigserial PRIMARY KEY,
        image        text,
        status       text NOT NULL DEFAULT '대기',
        result       jsonb,
        error        text,
        requested_by bigint,
        created_at   timestamptz NOT NULL DEFAULT now(),
        finished_at  timestamptz
      )`;
    await sql`
      ALTER TABLE vin_scan DROP CONSTRAINT IF EXISTS vin_scan_status`;
    await sql`
      ALTER TABLE vin_scan ADD CONSTRAINT vin_scan_status
        CHECK (status IN ('대기','실행중','완료','실패'))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vin_scan_status ON vin_scan (status, id)`;
    console.log("✅ vin_scan 준비됨");

    /**
     * 🔴 **기존 종류를 빠뜨리면 안 된다.** 제약을 통째로 다시 만드는 방식이라,
     *    한 번이라도 빠뜨리면 그 종류가 조용히 사라진다.
     *    (2026-09-05 에 `제원` 을 실제로 한 번 날렸다.)
     *    지금 값: 초안 · 스캔 · 정리 · 제원 · 발행사진 · 차량사진
     */
    await sql`ALTER TABLE blog_job DROP CONSTRAINT IF EXISTS blog_job_kind`;
    await sql`
      ALTER TABLE blog_job ADD CONSTRAINT blog_job_kind
        CHECK (kind IN ('초안','스캔','정리','제원','발행사진','차량사진'))`;
    console.log("✅ blog_job 주문 종류에 「차량사진」 추가됨");

    const [c] = await sql<{ d: string }[]>`
      SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'blog_job_kind'`;
    console.log(`   지금 제약: ${c.d}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
