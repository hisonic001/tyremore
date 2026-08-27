/**
 * 기표가 목록에 없지만 사장님이 알려주신 자재 (2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/kumho-owner-materials-20260827.ts
 *
 * 사장님: "아예 엑셀 파일 기반으로 품목 DB를 개선하고, 아까 말했던 엑셀에 없던 품목들도
 *          내가 말해준 것을 기반으로 같이 db에 적용해."
 *
 * 금호 「기표가 Master」에 없는 자재를 사장님이 자재내역·하중속도·가격까지 짚어 주셨다.
 * 그것도 자재 마스터에 넣어야 나머지 전부(매입 대조·상품 만들기·검증)가 같은 길을 탄다.
 * 값은 **부가세 포함가**로 주셔서 ÷1.1 해 미포함가로 넣는다.
 *
 * 🔴 출처를 `사장님 확인` 으로 남긴다 — 다음에 금호가 새 목록을 주면 그쪽이 이긴다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const LABEL = "사장님 확인(2026-08-27)";

/** [자재코드, 자재내역, 패턴, 제품군, LI, SS, 부가세 포함가] */
const OWNER: [string, string, string, string, string, string, number][] = [
  ["2420172", "KH 145     R13CR12L KC55 ;RC CHINA", "KC55", "LTR", "94", "R", 96800],
  ["2172062", "KH 225/60  R17 H04S KL33 HH;RK", "KL33", "LTR", "99", "H", 209000],
  ["5009992", "DS 195/85  R16  14L UA100  ;RC", "UA100", "LTR", "118", "L", 126500],
  ["2392102", "KH 145     R13CR08L KC53 AR;RC", "KC53", "LTR", "88", "R", 79200],
];

async function main() {
  for (const [code, name, pat, grp, li, ss, incl] of OWNER) {
    const excl = Math.round(incl / 1.1);
    const [had] = await db.execute<{ code: string; src: string | null }>(sql`
      SELECT code, source_label src FROM kumho_material WHERE code = ${code}`);
    await db.execute(sql`
      INSERT INTO kumho_material (code, name, pattern_code, product_group, op_type, op_status,
                                  load_index, speed_rating, price_excl, source_label, updated_at)
      VALUES (${code}, ${name}, ${pat}, ${grp}, '①', '정상', ${li}, ${ss}, ${excl}, ${LABEL}, now())
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, pattern_code = EXCLUDED.pattern_code, product_group = EXCLUDED.product_group,
        load_index = EXCLUDED.load_index, speed_rating = EXCLUDED.speed_rating,
        price_excl = EXCLUDED.price_excl, source_label = EXCLUDED.source_label, updated_at = now()`);
    console.log(`${had ? "갱신" : "새로"} ${code} ${pat} ${li}${ss} ${excl.toLocaleString()}원(미포함) — ${name}`);
  }
  const [n] = await db.execute<{ n: number; owner: number }>(sql`
    SELECT count(*)::int n, count(*) FILTER (WHERE source_label = ${LABEL})::int owner FROM kumho_material`);
  console.log(`\n✅ 자재 마스터 ${n.n}줄 (그중 사장님 확인분 ${n.owner})`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
