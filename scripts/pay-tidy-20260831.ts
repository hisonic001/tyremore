/**
 * ⭐ 미지급 정리 ④ — 사장님이 알려주신 「통장 이름 ↔ 거래처」 짝 반영 (2026-08-31)
 *
 *   "주식회사 위즈 -> 위즈오토, (주)딜러타이어 -> 블랙서클, (주)맥스런 -> 타이어핑,
 *    콘티_(주)싸이 -> 콘티(넨탈)"
 *
 *   ① 별명 학습(party_alias) — 다음부터 지급 잡기가 「→ 거래처 지급」을 바로 제안
 *   ② 자동분류 바로잡기 — 「조준호A금호타」가 주주거래로 오분류되던 규칙 → 매입대금
 *   ③ 딜러타이어 8/13 출금 500,000 → 블랙서클 인보이스 241,560 지급 연결
 *      (딜러타이어는 예치금 충전식 — 남은 258,440 은 출금 줄에 잔액으로 남아
 *       다음 블랙서클 인보이스가 들어오면 같은 줄에서 다시 잇는다)
 *   ④ 이을 인보이스가 없는 출금 접기 — 미쉐린 7월분 6건 · MFT 가결산 송금 ·
 *      위즈오토 2건 · 타이어핑 1건 · 딜러 예치금 100,000
 *
 *   실행: npx tsx --env-file=.env.local scripts/pay-tidy-20260831.ts [--apply]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { normName } from "@/lib/recon-data";

const APPLY = process.argv.includes("--apply");

/** ① 통장 이름 → 거래처 (사장님 확인) */
const ALIASES: [string, string][] = [
  ["콘티_(주)싸이", "콘티넨탈"],
  ["(주)딜러타이어", "블랙서클"],
  ["주식회사 위즈", "위즈오토"],
  ["(주)맥스런", "타이어핑"],
  ["조준호A금호타", "금호"],
  ["미쉐린코리아(", "미쉐린"],
];

/** ④ 접을 출금 — (날짜, 금액, 이름조각, 사연) */
const FOLDS: [string, number, string, string][] = [
  ["2026-08-04", 777480, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-08", 875688, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-14", 277574, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-20", 500000, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-21", 3901722, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-24", 1980528, "%미쉐린%", "앱 이전(7월분) 대금 — 이을 인보이스 없음"],
  ["2026-08-26", 36360, "%엠에프티%", "가결산 확정 송금(MFT) — 매입 장부 대상 아님"],
  ["2026-08-17", 190872, "%위즈%", "위즈오토 — 앱에 매입 장부 없음 (사장님 짝 확인)"],
  ["2026-08-24", 188000, "%위즈%", "위즈오토 — 앱에 매입 장부 없음 (사장님 짝 확인)"],
  ["2026-08-10", 205180, "%맥스런%", "타이어핑 — 앱에 매입 장부 없음 (사장님 짝 확인)"],
  ["2026-08-13", 100000, "%딜러타이어%", "딜러타이어 예치금 충전 — 다음 블랙서클 인보이스에 잇기"],
];

async function main() {
  console.log(APPLY ? "🔴 실행 모드 (--apply)\n" : "👀 보기만 합니다 (--apply 로 실행)\n");

  console.log("① 별명 학습 (통장 이름 → 거래처)");
  for (const [raw, sup] of ALIASES) {
    const key = normName(raw);
    console.log(`  · ${raw} → ${sup}`);
    if (APPLY) {
      await db.execute(sql`
        INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
        VALUES (${key}, ${raw}, ${"S:" + sup}, ${"거래처 " + sup})
        ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
          party_label = EXCLUDED.party_label, updated_at = now()
      `);
    }
  }

  console.log("\n② 자동분류 — 조준호A금호타: 주주거래 → 매입대금");
  if (APPLY) {
    await db.execute(sql`UPDATE expense_rule SET category = '매입대금' WHERE key = '조준호A금호타'`);
  }

  console.log("\n③ 딜러타이어 8/13 출금 500,000 → 블랙서클 241,560 지급");
  const [c] = await db.execute<{ id: number; l: string; linked: number }>(sql`
    SELECT c.id, c.account_label l,
           (SELECT count(*)::int FROM recon_match m WHERE m.kind='매입지급' AND m.src_table='cash_txn' AND m.src_id=c.id) linked
    FROM cash_txn c
    WHERE c.source='통장' AND c.is_active AND c.out_amount = 500000
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date = '2026-08-13'::date
      AND c.description LIKE '%딜러타이어%'
  `);
  const [inv] = await db.execute<{ id: number; remain: number }>(sql`
    SELECT pi.id, (pi.total - COALESCE((SELECT SUM(amount) FROM purchase_payment pp WHERE pp.invoice_id=pi.id),0))::int remain
    FROM purchase_invoice pi WHERE pi.invoice_no = '직접-20260814-01' AND pi.supplier = '블랙서클'
  `);
  if (!c || !inv || Number(inv.remain) <= 0 || Number(c.linked) > 0) {
    console.log("  · 이미 처리됐거나 대상 없음 (건너뜀)");
  } else {
    console.log(`  · 인보이스 직접-20260814-01 ${Number(inv.remain).toLocaleString()}원 완납 (출금 잔액 ${500000 - Number(inv.remain)}원은 예치금으로 남음)`);
    if (APPLY) {
      await db.execute(sql`
        INSERT INTO purchase_payment (invoice_id, amount, method, paid_on, memo)
        VALUES (${Number(inv.id)}, ${Number(inv.remain)}, '계좌이체', '2026-08-13',
                ${"통장 출금 연결 (" + (c.l ?? "신한") + " 2026-08-13) — 딜러타이어=블랙서클 (사장님 확인)"})
      `);
      await db.execute(sql`
        INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_at)
        VALUES ('매입지급', 'cash_txn', ${Number(c.id)}, 'purchase_invoice', ${Number(inv.id)}, ${Number(inv.remain)}, '확정', '수동', now())
      `);
      await db.execute(sql`UPDATE cash_txn SET recon_status = '확정' WHERE id = ${Number(c.id)}`);
    }
  }

  console.log("\n④ 이을 인보이스 없는 출금 접기");
  for (const [day, amount, like, why] of FOLDS) {
    const [row] = await db.execute<{ id: number; st: string; linked: number }>(sql`
      SELECT c.id, c.recon_status st,
             (SELECT count(*)::int FROM recon_match m WHERE m.kind='매입지급' AND m.src_table='cash_txn' AND m.src_id=c.id) linked
      FROM cash_txn c
      WHERE c.source='통장' AND c.is_active AND c.out_amount = ${amount}
        AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date = ${day}::date
        AND c.description LIKE ${like} AND c.recon_status <> '무시'
      ORDER BY c.id LIMIT 1
    `);
    if (!row || Number(row.linked) > 0) {
      console.log(`  · ${day} ${amount.toLocaleString()} — ${row ? "이미 이어짐" : "이미 접혔거나 없음"} (건너뜀)`);
      continue;
    }
    console.log(`  · ${day} ${amount.toLocaleString()}원 접기 — ${why}`);
    if (APPLY) {
      await db.execute(sql`
        UPDATE cash_txn SET recon_status = '무시', memo = COALESCE(memo || ' · ', '') || ${why + " (2026-08-31)"}
        WHERE id = ${Number(row.id)}
      `);
    }
  }

  const rest = await db.execute<{ d: string; desc: string; remain: string }>(sql`
    SELECT to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul','MM-DD') d, c.description "desc",
           (c.out_amount - COALESCE((SELECT SUM(m.amount) FROM recon_match m
             WHERE m.status='확정' AND ((m.ref_table='cash_txn' AND m.ref_id=c.id AND m.kind IN ('매출계산서','매입계산서'))
               OR (m.src_table='cash_txn' AND m.src_id=c.id AND m.kind IN ('매입지급','이체입금')))),0))::bigint remain
    FROM cash_txn c
    WHERE c.source='통장' AND c.is_active AND c.category='매입대금' AND c.recon_status <> '무시'
      AND c.occurred_at >= '2026-08-01'
  `);
  const open = rest.filter((r) => Number(r.remain) > 0);
  console.log(`\n남을 후보: ${open.length}건`);
  for (const r of open) console.log(`  · ${r.d} ${r.desc} ${Number(r.remain).toLocaleString()}원`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(0), 500));
