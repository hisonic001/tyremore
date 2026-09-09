/**
 * ⭐ 고객·차량·판매 정합 감시기 (연동 사고 2026-09-09 이후 상비)
 *
 *   서로 다른 손님이 한 고객 행에 섞이는 사고를 언제든 전수 점검한다.
 *   전부 0건이 정상. 의심되면 이것부터 돌린다.
 *
 *   ① 판매의 고객 ≠ 그 판매에 붙은 차량의 소유주 (거래처 차고 제외)
 *   ② 자리표시 이름(고객·관광객 등) 행에 차량 2대 이상
 *   ③ 더미 전화(010-1234-5678 등) 행에 이관 뒤 새 차량·새 판매가 붙음
 *
 * 실행: npx tsx --env-file=.env.local scripts/customer-integrity-check.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  let bad = 0;

  const mismatch = await db.execute<{ quote_no: string; qc: string; vc: string; plate: string }>(sql`
    SELECT q.quote_no, c1.name qc, c2.name vc, v.plate_no plate
    FROM quote q
    JOIN vehicle v ON v.id = q.vehicle_id
    JOIN customer c1 ON c1.id = q.customer_id
    JOIN customer c2 ON c2.id = v.customer_id
    WHERE q.customer_id IS NOT NULL AND q.customer_id <> v.customer_id
      AND c2.supplier_name IS NULL AND c1.supplier_name IS NULL
    ORDER BY q.id`);
  console.log(`① 판매 고객 ≠ 차량 소유주: ${mismatch.length}건`);
  for (const m of mismatch) console.log(`   · ${m.quote_no} 판매고객 「${m.qc}」 vs 차량(${m.plate}) 소유 「${m.vc}」`);
  bad += mismatch.length;

  const multi = await db.execute<{ id: number; name: string; n: number }>(sql`
    SELECT c.id, c.name, count(v.id)::int n
    FROM customer c JOIN vehicle v ON v.customer_id = c.id
    WHERE c.supplier_name IS NULL
      AND trim(c.name) IN ('고객','김고객','관광객','비회원','손님','일반고객')
    GROUP BY c.id HAVING count(v.id) >= 2 ORDER BY n DESC`);
  console.log(`② 자리표시 행에 차량 2대 이상: ${multi.length}행`);
  for (const m of multi) console.log(`   · 고객 ${m.id} 「${m.name}」 차량 ${m.n}대 — 손님이 섞였을 수 있음`);
  bad += multi.length;

  const dummyNew = await db.execute<{ id: number; name: string; phone: string; ncars: number; nquotes: number }>(sql`
    SELECT c.id, c.name, c.phone,
           (SELECT count(*)::int FROM vehicle v WHERE v.customer_id = c.id AND v.created_at > '2026-08-02') ncars,
           (SELECT count(*)::int FROM quote q WHERE q.customer_id = c.id AND q.created_at > '2026-08-02'
              AND (q.vehicle_id IS NULL OR EXISTS (SELECT 1 FROM vehicle v2 WHERE v2.id = q.vehicle_id AND v2.customer_id <> c.id))) nquotes
    FROM customer c
    WHERE c.supplier_name IS NULL
      AND (replace(replace(COALESCE(c.phone,''),'-',''),' ','') IN ('01012345678','01011112222','01023456789')
           OR replace(replace(COALESCE(c.phone,''),'-',''),' ','') ~ '^010(\\d)\\1+$')
      AND ((SELECT count(*) FROM vehicle v WHERE v.customer_id = c.id AND v.created_at > '2026-08-02') >= 2)
    ORDER BY c.id`);
  console.log(`③ 더미 전화 행에 이관 뒤 차량 2대 이상: ${dummyNew.length}행`);
  for (const d of dummyNew) console.log(`   · 고객 ${d.id} 「${d.name}」 ${d.phone} — 새 차량 ${d.ncars}대`);
  bad += dummyNew.length;

  console.log(bad === 0 ? "\n✅ 전부 정상 — 섞인 고객 없음" : `\n⚠ 이상 ${bad}건 — 위 목록 확인 필요`);
  process.exit(0);
}
main();
