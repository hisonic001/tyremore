/**
 * 2025 진행(2026-08-27)에서 확인된 별명 — 강남세차장카센타의 지급 출금이 「강릉강남타이어」「강릉 강남타이」로 찍힌다
 * (17,674,250 계산서 ↔ 6/5 출금 17,674,750 = +500 수수료, 1,949,519 ↔ 7/1 1,950,019 …). 월정산 잔액 6천만원 허수의 원인.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normName } from "@/lib/recon-data";
const BIZ = "2260438974";
async function main() {
  for (const raw of ["강릉강남타이어", "강릉 강남타이"]) {
    await db.execute(sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES (${normName(raw) + "@" + BIZ}, ${raw}, ${"T:" + BIZ}, ${"지급출금 강남세차장카센타"})
      ON CONFLICT (alias_key) DO NOTHING`);
    console.log("alias", raw);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
