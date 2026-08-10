/**
 * app_setting 테이블 추가 (2026-08-10)
 *
 * 사장님 요청: MARS 입력 평가 리포트 + "정비사 계정에서도 보이도록 권한 설정".
 * 리포트의 두 가지 설정을 담을 곳이 필요하다:
 *   · mars_report_tech      — '1' 이면 정비사 계정도 /reports/mars 를 본다
 *   · mars_target_2026Q3 …  — 분기별 미쉐린 타겟 수량 (평가표 I-1 의 분모)
 * 열 하나짜리 값들이라 표를 따로 만들지 않고 키-값 한 표로 둔다.
 * 실행: npx tsx scripts/add-app-setting.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`CREATE TABLE IF NOT EXISTS app_setting (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    console.log("✅ app_setting 준비됨");
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
