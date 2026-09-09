/**
 * ⭐ 자리표시 「고객」 행에 섞인 손님들 분리 (연동 사고 2026-09-09)
 *
 *   MARS 이관 자리표시 264(전화 010-1234-5678)·265(전화 없음)에 이관 뒤
 *   서로 다른 손님 12명의 차가 붙어, 한쪽 정보를 고치면 전부 함께 바뀌었다
 *   (박은지 벤츠 2건 신고). 이관 뒤(2026-08-02 이후) 붙은 차량마다 **새 고객
 *   행**을 만들어 차량과 그 차량의 판매를 옮긴다. 이관 원본 차량·판매는 그대로.
 *
 *   멱등: 옮긴 차량은 더 이상 대상이 아니므로 재실행하면 0건.
 *
 * 실행: npx tsx --env-file=.env.local scripts/split-placeholder-customer.ts        (보기만)
 *       npx tsx --env-file=.env.local scripts/split-placeholder-customer.ts --fix  (분리)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const MIGRATED_BEFORE = "2026-08-02"; // 이관은 8/1 — 그 뒤에 붙은 차만 잘못 묶인 것

async function main() {
  const doFix = process.argv.includes("--fix");

  // 대상: 자리표시 이름 「고객」(거래처 아님) + 차량 2대 이상 → 이관 뒤 붙은 차량들
  const targets = await db.execute<{
    cid: number;
    cname: string;
    vid: number;
    plate: string;
    model: string | null;
    nquotes: number;
  }>(sql`
    SELECT c.id cid, c.name cname, v.id vid, v.plate_no plate, v.model,
           (SELECT count(*)::int FROM quote q WHERE q.vehicle_id = v.id AND q.customer_id = c.id) nquotes
    FROM customer c
    JOIN vehicle v ON v.customer_id = c.id
    WHERE c.supplier_name IS NULL AND trim(c.name) = '고객'
      AND v.created_at > ${MIGRATED_BEFORE}::date
      AND (SELECT count(*) FROM vehicle v2 WHERE v2.customer_id = c.id) >= 2
    ORDER BY c.id, v.id`);

  if (targets.length === 0) {
    console.log("분리할 차량 0대 — 이미 정리됨");
    process.exit(0);
  }

  console.log(`── 분리 대상 ${targets.length}대 ──`);
  for (const t of targets) {
    console.log(`고객 ${t.cid} ← 차량 ${t.vid} ${t.plate}${t.model ? ` (${t.model})` : ""} · 판매 ${t.nquotes}건`);
  }

  if (!doFix) {
    console.log("\n(보기만 했음 — 분리하려면 --fix)");
    process.exit(0);
  }

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  for (const t of targets) {
    await db.transaction(async (tx) => {
      const [nc] = await tx.execute<{ id: number }>(sql`
        INSERT INTO customer (name, name_search, type, memo)
        VALUES ('고객', '고객', '개인',
                ${`자리표시 분리 ${today} — 고객 ${t.cid}에 잘못 묶여 있던 차량 ${t.plate}. 실명·전화를 아시면 채워 주세요`})
        RETURNING id`);
      await tx.execute(sql`UPDATE vehicle SET customer_id = ${nc.id} WHERE id = ${t.vid}`);
      const moved = await tx.execute<{ id: number }>(sql`
        UPDATE quote SET customer_id = ${nc.id}
        WHERE vehicle_id = ${t.vid} AND customer_id = ${t.cid}
        RETURNING id`);
      console.log(`✓ 차량 ${t.plate} → 새 고객 ${nc.id} (판매 ${moved.length}건 함께)`);
    });
  }

  // 뒷정리 확인
  const left = await db.execute<{ cid: number; n: number }>(sql`
    SELECT c.id cid, count(v.id)::int n FROM customer c JOIN vehicle v ON v.customer_id = c.id
    WHERE c.supplier_name IS NULL AND trim(c.name) = '고객'
    GROUP BY c.id HAVING count(v.id) >= 2`);
  console.log(left.length === 0 ? "\n재검사: 차량 2대 이상 남은 「고객」 행 없음 — 완료" : `\n⚠ 아직 남음: ${JSON.stringify(left)}`);
  process.exit(0);
}
main();
