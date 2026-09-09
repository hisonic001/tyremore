/**
 * ⭐ 사진 시도 진단 기록 (사장님 요청 2026-09-09)
 *
 *   "핸드폰 기종이나 다른 조건에 의해서도 오류가 생길 수 있는지 데이터를 통해 검증"
 *   — 지금까지는 폰 안에서 끝나는 실패(HEIC 못 열기 등)가 흔적 0 이었다.
 *   시도마다 기종(ua)·원본 형식·크기·변환 시간을 meta 로 남긴다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-vin-scan-meta.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`ALTER TABLE vin_scan ADD COLUMN IF NOT EXISTS meta jsonb`);
  console.log("vin_scan.meta 준비됨");
  process.exit(0);
}
main();
