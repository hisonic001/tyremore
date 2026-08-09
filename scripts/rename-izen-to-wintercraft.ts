/**
 * 일회성 (2026-08-09) — 사장님 요청:
 *   "금호타이어 중에서 WinterCraft KW17의 경우 IZEN XW 로 되어있는데
 *    전부 WinterCraft로 수정해줄래?"
 *
 * KW17 은 금호가 IZEN XW 이름으로 내다가 WinterCraft 로 재편한 모델이다.
 * MARS 이관본이 옛 이름을 갖고 있어 검색·카드에 IZEN XW 로 보였다.
 * display_name(화면 이름)과 pattern(검색·모델 묶음) 둘 다 바꾼다.
 * raw_name 은 MARS 원본이라 손대지 않는다 (D-14 — MARS 검색은 원본 이름으로 한다).
 * 실행: npx tsx scripts/rename-izen-to-wintercraft.ts
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql<{ id: number; display_name: string; pattern: string }[]>`
      UPDATE product
      SET display_name = replace(display_name, 'IZEN XW', 'WinterCraft'),
          pattern      = replace(pattern,      'IZEN XW', 'WinterCraft'),
          updated_at   = now()
      WHERE brand_code = 'KM'
        AND (display_name LIKE '%IZEN XW%' OR pattern LIKE '%IZEN XW%')
      RETURNING id, display_name, pattern
    `;
    console.log(`✅ IZEN XW → WinterCraft ${rows.length}건`);
    for (const r of rows) console.log(`  #${r.id} ${r.display_name} | ${r.pattern}`);

    const left = await sql<{ n: number }[]>`
      SELECT count(*)::int n FROM product
      WHERE brand_code='KM' AND (display_name ILIKE '%IZEN%' OR pattern ILIKE '%IZEN%')`;
    console.log(`남은 IZEN 표기: ${left[0].n}건`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
