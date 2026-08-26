/**
 * 월정산 거래처 시드 (2025 감사 D1, 2026-08-26)
 *
 *   2025년 실측: 계산서는 많고 통장 출금은 드문 「월합계형」 공급처인데 월정산 규칙이 없어
 *   2025-12 매입에 개별 카드 39장(딜러타이어 15장)이 늘어섰다. 강남세차장은 계산서 10건/8,400만원
 *   대비 통장 줄이 연 2건 — 1:1 매칭이 원리적으로 불가능한 곳들이다.
 *   이미 다른 규칙이 있으면 건드리지 않는다(ON CONFLICT DO NOTHING). 「이 상대 기억하기」의 ✕로
 *   한 번에 취소된다(전 기간 되살림).
 *
 *   npx tsx scripts/seed-monthly-20260826.ts   (멱등)
 */
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local" });

const NAMES = ["딜러타이어", "엠에프티코리아", "쌍성트레이딩", "강남세차장", "티스테이션 양양점", "프로디테일"];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    for (const nm of NAMES) {
      const cands = await sql<{ biz_no: string; name: string; n: number }[]>`
        SELECT counterparty_biz_no biz_no, max(counterparty_name) name, count(*)::int n
        FROM tax_invoice
        WHERE is_active AND direction = '매입'
          AND replace(replace(counterparty_name, ' ', ''), '주식회사', '') ILIKE ${"%" + nm.replace(/\s/g, "") + "%"}
        GROUP BY 1 ORDER BY 3 DESC LIMIT 3`;
      if (cands.length === 0) { console.log(`- ${nm}: 계산서 없음 (건너뜀)`); continue; }
      if (cands.length > 1) console.log(`  ⚠ ${nm}: 사업자번호 ${cands.length}개 — 건수 가장 많은 것만`, cands.map((c) => `${c.biz_no}(${c.n})`).join(", "));
      const c = cands[0];
      const r = await sql`
        INSERT INTO tax_party_rule (biz_no, name_raw, kind) VALUES (${c.biz_no}, ${c.name}, '월정산')
        ON CONFLICT (biz_no) DO NOTHING RETURNING biz_no`;
      const existing = r.length === 0 ? await sql<{ kind: string }[]>`SELECT kind FROM tax_party_rule WHERE biz_no = ${c.biz_no}` : [];
      console.log(`- ${c.name} (${c.biz_no}, 매입 ${c.n}건): ${r.length ? "월정산 지정 ✓" : `이미 규칙 있음(${existing[0]?.kind}) — 그대로 둠`}`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
